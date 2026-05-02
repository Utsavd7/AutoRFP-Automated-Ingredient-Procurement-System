import { NextResponse } from 'next/server';
import { callGroqThenOllama, parseJSON as parseLLMJSON } from '@/lib/llm';
import { getEmbedding } from '@/lib/embeddings';
import { ingestQuote } from '@/lib/chroma';
import { prisma } from '@/lib/prisma';

const MAX_TURNS = 1;

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
        const { rfpId, ingredients = [], pricingData = [], tenantId = 'tenant_demo', mealName, guestCount, bufferPct } = await req.json();

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
        if (rfp.status === 'REPLIED' || rfp.status === 'ACCEPTED' || rfp.status === 'DECLINED') {
            return NextResponse.json({ error: 'This RFP already has a quote submitted.' }, { status: 400 });
        }

        // Compute the estimated market total from real data
        const estimatedTotal = computeEstimatedTotal(ingredients, pricingData);
        const ingredientBreakdown = buildIngredientBreakdown(ingredients, pricingData);
        const orderContext = [
            mealName ? `Meal: ${mealName}` : '',
            guestCount ? `Guest count: ${guestCount}` : '',
            typeof bufferPct === 'number' ? `Buffer already included in requested quantities: ${bufferPct}%` : '',
        ].filter(Boolean).join('\n');

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
${orderContext ? `${orderContext}\n` : ''}
${ingredientBreakdown}
TOTAL estimated market cost: $${estimatedTotal.toFixed(2)}
A typical vendor would quote between $${vendorMarkupLow} and $${vendorMarkupHigh} (5–20% margin).
Your quote MUST fall within or near this range to be realistic.`
                    : `Quote a realistic total for the requested meal order.${orderContext ? `\n${orderContext}` : ''}`;

                const vendorPrompt = isFollowUp
                    ? `You are a real food wholesale vendor (${rfp.distributor.name}). 
AutoRFP sent a follow-up asking for clarification. Previous context: """${lastMessage}"""
${pricingContext}

Write a professional vendor reply that CLEARLY states a specific total dollar price and delivery schedule.`
                    : `You are a real food wholesale vendor called ${rfp.distributor.name}, based at ${rfp.distributor.location}.
A restaurant procurement system called AutoRFP sent you an RFP for bulk ingredient sourcing.
${pricingContext}

Write a realistic vendor reply email (${turn === 1 && rfpId.charCodeAt(0) % 2 === 0 ? 'keep pricing slightly vague — give a range but not a firm total yet' : 'include a clear total quoted price and delivery terms'}).
Be professional but conversational. Do NOT use placeholder text.`;

                const vendorEmail = await callGroqThenOllama([{ role: 'user', content: vendorPrompt }]) || 'Thank you for reaching out. We will get back to you shortly.';
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

                const agentParseText = await callGroqThenOllama([
                    { role: 'system', content: 'You are a JSON-only API. Output only valid JSON.' },
                    { role: 'user', content: agentParsePrompt }
                ], true);

                const parsed = parseLLMJSON<any>(agentParseText) ?? JSON.parse(agentParseText || '{}');

                if (parsed.price && !isNaN(Number(parsed.price)) && parsed.confidence !== 'LOW') {
                    const details = [
                        parsed.deliveryTerms ? `Delivery: ${parsed.deliveryTerms}` : '',
                        parsed.details || '',
                        hasRealPricing ? `[Based on real market pricing: est. $${estimatedTotal.toFixed(2)}]` : '',
                        `[AI Turn ${turn}, Confidence: ${parsed.confidence}]`
                    ].filter(Boolean).join(' | ');

                    const newQuote = await prisma.quote.create({
                        data: { rfpId, price: Number(parsed.price), details, status: 'SUBMITTED' }
                    });

                    await prisma.rFP.update({
                        where: { id: rfpId },
                        data: {
                            status: 'REPLIED',
                            repliedAt: new Date(),
                        }
                    });

                    quoteResult = newQuote;

                    // Async RAG ingest — fire and forget, never blocks the response
                    const ingText = `Supplier: ${rfp.distributor.name}, Location: ${rfp.distributor.location}. Quoted $${newQuote.price.toFixed(2)} for ${ingredients.length} ingredients. Details: ${newQuote.details ?? 'N/A'}`;
                    getEmbedding(ingText).then(emb => {
                        if (emb) ingestQuote({ id: newQuote.id, text: ingText, embedding: emb, metadata: { tenantId, distributorName: rfp.distributor.name, location: rfp.distributor.location, price: newQuote.price, ingredients: ingredients.map((i: any) => i.name).join(', '), timestamp: new Date().toISOString() } });
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

                    const followUpEmail = await callGroqThenOllama([{ role: 'user', content: followUpPrompt }]) || 'Could you please clarify your total pricing for this order?';
                    conversationLog.push({ role: 'AutoRFP Agent', message: followUpEmail });
                    lastMessage = followUpEmail;
                    isFollowUp = true;
                }
            }
        } catch (aiError: any) {
            console.warn('LLM providers failed during conversation simulation, attempting simplified fallback call:', aiError.message);

            // Deterministic vendor margin: hash the distributor name to a stable 8–15% markup
            let nameHash = 0;
            for (let i = 0; i < rfp.distributor.name.length; i++) nameHash = rfp.distributor.name.charCodeAt(i) + ((nameHash << 5) - nameHash);
            const marginPct = 0.08 + (Math.abs(nameHash) % 8) / 100; // 8–15%, deterministic
            const deliveryFee = 25 + (Math.abs(nameHash) % 20); // $25–$44, deterministic

            const mockBasePrice = hasRealPricing
                ? estimatedTotal * (1 + marginPct)
                : 850 + (Math.abs(nameHash) % 400); // $850–$1249, deterministic
            const totalMockPrice = mockBasePrice + deliveryFee;

            // Try a quick simplified Ollama call for a more natural vendor message
            let vendorMessage: string | null = null;
            try {
                vendorMessage = await callGroqThenOllama([{
                    role: 'user',
                    content: `You are ${rfp.distributor.name}, a wholesale food vendor. Write a 2-sentence reply to a bulk ingredient RFP quoting a total of $${totalMockPrice.toFixed(2)} with delivery Tuesday and Friday. Be professional and specific.`
                }]);
            } catch { /* truly last resort below */ }

            conversationLog.push({
                role: rfp.distributor.name,
                message: vendorMessage?.trim() || `Thank you for reaching out to ${rfp.distributor.name}. After reviewing your RFP for ${ingredients.length} ingredients, we can fulfill this order at $${mockBasePrice.toFixed(2)} plus a $${deliveryFee.toFixed(0)} delivery fee — total $${totalMockPrice.toFixed(2)}. We deliver Tuesday and Friday mornings; please confirm by 4 PM the prior day.`
            });

            conversationLog.push({
                role: 'AutoRFP Agent',
                message: `✅ Quote extracted: $${totalMockPrice.toFixed(2)}.${hasRealPricing ? ` Market baseline was $${estimatedTotal.toFixed(2)}.` : ''} Saved.`
            });

            const newQuote = await prisma.quote.create({
                data: {
                    rfpId,
                    price: totalMockPrice,
                    details: `Delivery: Tuesday/Friday Morning ($${deliveryFee} fee). | ${hasRealPricing ? `Calculated from real market pricing for ${ingredients.length} ingredients (est. $${estimatedTotal.toFixed(2)} baseline).` : 'Full bulk order fulfillment confirmed.'} | [Calculated Fallback, Confidence: HIGH]`,
                    status: 'SUBMITTED',
                }
            });

            await prisma.rFP.update({
                where: { id: rfpId },
                data: {
                    status: 'REPLIED',
                    repliedAt: new Date(),
                }
            });
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
