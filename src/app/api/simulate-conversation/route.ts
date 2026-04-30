import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { getEmbedding } from '@/lib/embeddings';
import { ingestQuote } from '@/lib/chroma';

const openai = process.env.GROQ_API_KEY
    ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
    : null;

const prisma = new PrismaClient();

const MAX_TURNS = 3;

/**
 * Given the aggregated ingredient list and current market prices,
 * compute a realistic estimated total order cost.
 */
function computeEstimatedTotal(
    ingredients: { name: string; quantity: number; unit: string }[],
    pricingData: { name: string; currentPrice: number }[]
): number {
    const priceMap = new Map(pricingData.map((p) => [p.name.toLowerCase(), p.currentPrice]));

    let total = 0;
    for (const ing of ingredients) {
        const price = priceMap.get(ing.name.toLowerCase());
        if (price && typeof ing.quantity === 'number') {
            total += price * ing.quantity;
        } else if (price) {
            total += price; // fallback: treat as 1 unit
        }
    }

    // If we couldn't match any ingredients, fall back to a reasonable default
    return total > 0 ? total : 0;
}

function buildIngredientBreakdown(
    ingredients: { name: string; quantity: number; unit: string }[],
    pricingData: { name: string; currentPrice: number }[]
): string {
    const priceMap = new Map(pricingData.map((p) => [p.name.toLowerCase(), p.currentPrice]));
    return ingredients.map((ing) => {
        const price = priceMap.get(ing.name.toLowerCase());
        const lineTotal = price && typeof ing.quantity === 'number' ? (price * ing.quantity).toFixed(2) : 'N/A';
        return `  - ${ing.name}: ${ing.quantity} ${ing.unit} @ $${price?.toFixed(2) ?? '?.??'}/unit = $${lineTotal}`;
    }).join('\n');
}

// POST /api/simulate-conversation
export async function POST(req: Request) {
    try {
        const { rfpId, ingredients = [], pricingData = [] } = await req.json();

        if (!openai) {
            return NextResponse.json({ error: 'GROQ_API_KEY is missing.' }, { status: 500 });
        }

        if (!rfpId) {
            return NextResponse.json({ error: 'rfpId is required.' }, { status: 400 });
        }

        const rfp = await prisma.rFP.findUnique({
            where: { id: rfpId },
            include: { distributor: true }
        });

        if (!rfp) {
            return NextResponse.json({ error: 'RFP not found.' }, { status: 404 });
        }
        if (rfp.status === 'REPLIED') {
            return NextResponse.json({ error: 'This RFP already has a quote submitted.' }, { status: 400 });
        }

        // Compute the estimated market total from real data
        const estimatedTotal = computeEstimatedTotal(ingredients, pricingData);
        const ingredientBreakdown = buildIngredientBreakdown(ingredients, pricingData);

        // Vendors typically quote 5–20% above market cost
        const vendorMarkupLow = (estimatedTotal * 1.05).toFixed(2);
        const vendorMarkupHigh = (estimatedTotal * 1.20).toFixed(2);
        const hasRealPricing = estimatedTotal > 0;

        const conversationLog: { role: string; message: string }[] = [];
        let quoteResult = null;
        let turn = 0;
        let lastMessage = '';
        let isFollowUp = false;

        try {
            while (turn < MAX_TURNS && !quoteResult) {
                turn++;

                const pricingContext = hasRealPricing
                    ? `
The following real wholesale market data was used to estimate the order cost:
${ingredientBreakdown}
TOTAL estimated market cost: $${estimatedTotal.toFixed(2)}
A typical vendor would quote between $${vendorMarkupLow} and $${vendorMarkupHigh} (5–20% margin).
Your quote MUST fall within or near this range to be realistic.`
                    : `Quote a realistic total between $600 and $1200 for a standard restaurant bulk ingredient order.`;

                const vendorPrompt = isFollowUp
                    ? `You are a real food wholesale vendor (${rfp.distributor.name}). 
AutoRFP sent a follow-up asking for clarification. Previous context: """${lastMessage}"""
${pricingContext}

Write a professional vendor reply that CLEARLY states a specific total dollar price and delivery schedule.`
                    : `You are a real food wholesale vendor called ${rfp.distributor.name}, based at ${rfp.distributor.location}.
A restaurant procurement system called AutoRFP sent you an RFP for bulk ingredient sourcing.
${pricingContext}

Write a realistic vendor reply email (${turn === 1 && Math.random() > 0.5 ? 'keep pricing slightly vague — give a range but not a firm total yet' : 'include a clear total quoted price and delivery terms'}).
Be professional but conversational. Do NOT use placeholder text.`;

                const vendorResponse = await openai.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'user', content: vendorPrompt }]
                });

                const vendorEmail = vendorResponse.choices[0].message.content || 'Thank you for reaching out. We will get back to you shortly.';
                conversationLog.push({ role: rfp.distributor.name, message: vendorEmail });

                // Agent parses the vendor reply
                const agentParsePrompt = `
You are an expert AI procurement agent. Parse this vendor email and extract:
{
    "price": Number | null,
    "deliveryTerms": "String",
    "details": "String",
    "confidence": "String",
    "missingInfo": ["String"]
}
Vendor email:
"""${vendorEmail}"""
`;

                const agentResponse = await openai.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: 'You are a JSON-only API. Output only valid JSON.' },
                        { role: 'user', content: agentParsePrompt }
                    ],
                    response_format: { type: 'json_object' }
                });

                const parsed = JSON.parse(agentResponse.choices[0].message.content || '{}');

                if (parsed.price && !isNaN(Number(parsed.price)) && parsed.confidence !== 'LOW') {
                    const details = [
                        parsed.deliveryTerms ? `Delivery: ${parsed.deliveryTerms}` : '',
                        parsed.details || '',
                        hasRealPricing ? `[Based on real market pricing: est. $${estimatedTotal.toFixed(2)}]` : '',
                        `[AI Turn ${turn}, Confidence: ${parsed.confidence}]`
                    ].filter(Boolean).join(' | ');

                    const newQuote = await prisma.quote.create({
                        data: { rfpId, price: Number(parsed.price), details }
                    });

                    await prisma.rFP.update({ where: { id: rfpId }, data: { status: 'REPLIED' } });

                    quoteResult = newQuote;

                    // Async RAG ingest — fire and forget, never blocks the response
                    const ingText = `Supplier: ${rfp.distributor.name}, Location: ${rfp.distributor.location}. Quoted $${newQuote.price.toFixed(2)} for ${ingredients.length} ingredients. Details: ${newQuote.details ?? 'N/A'}`;
                    getEmbedding(ingText).then(emb => {
                        if (emb) ingestQuote({ id: newQuote.id, text: ingText, embedding: emb, metadata: { distributorName: rfp.distributor.name, location: rfp.distributor.location, price: newQuote.price, ingredients: ingredients.map((i: any) => i.name).join(', '), timestamp: new Date().toISOString() } });
                    }).catch(() => {});

                    conversationLog.push({
                        role: 'AutoRFP Agent',
                        message: `✅ Quote extracted: $${Number(parsed.price).toFixed(2)}.${hasRealPricing ? ` Market baseline was $${estimatedTotal.toFixed(2)}.` : ''} Saved to database.`
                    });
                } else {
                    const followUpPrompt = `
You are a professional procurement manager. A vendor replied but their email is missing clear pricing.
Missing: ${JSON.stringify(parsed.missingInfo?.length ? parsed.missingInfo : ['total price'])}
Their email: """${vendorEmail}"""

Write a short, polite follow-up asking for clarification (2-3 sentences only).`;

                    const followUpResponse = await openai.chat.completions.create({
                        model: 'llama-3.3-70b-versatile',
                        messages: [{ role: 'user', content: followUpPrompt }]
                    });

                    const followUpEmail = followUpResponse.choices[0].message.content || 'Could you please clarify your total pricing for this order?';
                    conversationLog.push({ role: 'AutoRFP Agent', message: followUpEmail });
                    lastMessage = followUpEmail;
                    isFollowUp = true;
                }
            }
        } catch (aiError: any) {
            console.warn('Groq API failed during conversation simulation, using calculated mock fallback:', aiError.message);

            // Use real pricing if available, otherwise use a sensible default
            const mockBasePrice = hasRealPricing
                ? estimatedTotal * (1.08 + Math.random() * 0.07) // 8-15% vendor margin on real cost
                : Math.floor(Math.random() * (1200 - 800) + 800);
            const deliveryFee = 25;
            const totalMockPrice = mockBasePrice + deliveryFee;

            conversationLog.push({
                role: rfp.distributor.name,
                message: `Hi, this is Mike from ${rfp.distributor.name}. I've reviewed your RFP for the bulk ingredient order.${hasRealPricing ? ` Based on current market rates for the ${ingredients.length} ingredients requested, our total comes to $${mockBasePrice.toFixed(2)}, which includes our standard 10% handling margin over wholesale cost.` : ` Our pricing for this batch is $${mockBasePrice.toFixed(2)}.`} Plus a flat $${deliveryFee} delivery fee — total $${totalMockPrice.toFixed(2)}. We deliver Tuesday and Friday mornings. Let us know by 4 PM the day before.`
            });

            conversationLog.push({
                role: 'AutoRFP Agent',
                message: `✅ Quote extracted: $${totalMockPrice.toFixed(2)}.${hasRealPricing ? ` Market baseline was $${estimatedTotal.toFixed(2)}.` : ''} Saved.`
            });

            const newQuote = await prisma.quote.create({
                data: {
                    rfpId,
                    price: totalMockPrice,
                    details: `Delivery: Tuesday/Friday Morning ($${deliveryFee} fee). | ${hasRealPricing ? `Calculated from real market pricing for ${ingredients.length} ingredients (est. $${estimatedTotal.toFixed(2)} baseline).` : 'Full bulk order fulfillment confirmed.'} | [Calculated Fallback, Confidence: HIGH]`
                }
            });

            await prisma.rFP.update({ where: { id: rfpId }, data: { status: 'REPLIED' } });
            quoteResult = newQuote;

            // Async RAG ingest — fire and forget
            const ingText2 = `Supplier: ${rfp.distributor.name}, Location: ${rfp.distributor.location}. Quoted $${newQuote.price.toFixed(2)} for ${ingredients.length} ingredients. Details: ${newQuote.details ?? 'N/A'}`;
            getEmbedding(ingText2).then(emb => {
                if (emb) ingestQuote({ id: newQuote.id, text: ingText2, embedding: emb, metadata: { distributorName: rfp.distributor.name, location: rfp.distributor.location, price: newQuote.price, ingredients: ingredients.map((i: any) => i.name).join(', '), timestamp: new Date().toISOString() } });
            }).catch(() => {});

            turn = 1;
        }

        return NextResponse.json({
            success: !!quoteResult,
            turnsCompleted: turn,
            savedQuote: quoteResult,
            conversationLog,
            estimatedMarketTotal: hasRealPricing ? estimatedTotal : null,
            message: quoteResult
                ? `Quote of $${Number(quoteResult.price).toFixed(2)} captured after ${turn} turn(s).${hasRealPricing ? ` Market baseline: $${estimatedTotal.toFixed(2)}.` : ''}`
                : `Conversation completed ${turn} turns but no clear quote was extracted.`
        });

    } catch (error: any) {
        console.error('Simulation error:', error);
        return NextResponse.json({ error: error.message || 'Simulation failed' }, { status: 500 });
    }
}
