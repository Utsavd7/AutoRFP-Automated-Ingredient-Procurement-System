import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaClient } from '@prisma/client';

const genAI = process.env.GEMINI_API_KEY
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    : null;

const prisma = new PrismaClient();

const MAX_TURNS = 3;

// POST /api/simulate-conversation
// Fully simulates a back-and-forth vendor email conversation using Gemini as both sides
export async function POST(req: Request) {
    try {
        const { rfpId } = await req.json();

        if (!genAI) {
            return NextResponse.json({ error: 'GEMINI_API_KEY is missing.' }, { status: 500 });
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

        const conversationLog: { role: string; message: string }[] = [];
        let quoteResult = null;
        let turn = 0;

        // The initial RFP email context (from AutoRFP to vendor)
        const rfpContext = `
You sent an RFP from AutoRFP procurement system to ${rfp.distributor.name} asking for wholesale ingredient pricing.
The RFP requested: various restaurant ingredients in bulk quantities.
        `.trim();

        // Seed the first vendor reply context
        let lastMessage = rfpContext;
        let isFollowUp = false;

        try {
            while (turn < MAX_TURNS && !quoteResult) {
                turn++;

                // STEP 1: Gemini plays the VENDOR and writes a reply email
                const vendorPrompt = isFollowUp
                    ? `You are a real food wholesale vendor (${rfp.distributor.name}). 
                       AutoRFP has just sent you a follow-up email asking for clarification.
                       Previous message context: """${lastMessage}"""
                       
                       Now write a realistic, professional vendor reply email that CLEARLY states:
                       - A specific total dollar price (e.g., "$620 for the full order")
                       - Your delivery schedule or lead time
                       Be realistic, somewhat informal, like a real vendor would write.`
                    : `You are a real food wholesale vendor called ${rfp.distributor.name}, based at ${rfp.distributor.location}.
                       A restaurant procurement system called AutoRFP just sent you an RFP (Request for Proposal) for ingredient sourcing.
                       
                       Write a realistic vendor reply email (${turn === 1 && Math.random() > 0.5 ? 'keep it vague — only mention an approximate price range without a firm total' : 'include a clear total quoted price and delivery terms'}).
                       Be professional but conversational, like a real local distributor would write.
                       Do NOT use placeholder text. Make it feel like a real email.`;

                const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
                const vendorResult = await model.generateContent(vendorPrompt);
                const vendorResponse = await vendorResult.response;
                const vendorEmail = vendorResponse.text() || 'Thank you for reaching out. We will get back to you shortly.';
                conversationLog.push({ role: rfp.distributor.name, message: vendorEmail });

                // STEP 2: Gemini plays the PROCUREMENT AGENT and parses the vendor reply
                const agentParsePrompt = `
                    You are an expert AI procurement agent. Parse this vendor email and extract:
                    {
                        "price": Number | null, // total numeric price, null if unclear
                        "deliveryTerms": "String",
                        "details": "String",
                        "confidence": "String", // HIGH, MEDIUM, or LOW
                        "missingInfo": ["String"] // empty if everything is clear
                    }
                    
                    Vendor email:
                    """${vendorEmail}"""
                `;

                const agentModel = genAI!.getGenerativeModel({
                    model: 'gemini-2.0-flash',
                    generationConfig: { responseMimeType: 'application/json' }
                });

                const agentResult = await agentModel.generateContent(agentParsePrompt);
                const agentResponse = await agentResult.response;
                const parsed = JSON.parse(agentResponse.text() || '{}');

                if (parsed.price && !isNaN(Number(parsed.price)) && parsed.confidence !== 'LOW') {
                    // ✅ Valid quote extracted — save it
                    const details = [
                        parsed.deliveryTerms ? `Delivery: ${parsed.deliveryTerms}` : '',
                        parsed.details || '',
                        `[AI Conversation Turn ${turn}, Confidence: ${parsed.confidence}]`
                    ].filter(Boolean).join(' | ');

                    const newQuote = await prisma.quote.create({
                        data: { rfpId, price: Number(parsed.price), details }
                    });

                    await prisma.rFP.update({
                        where: { id: rfpId },
                        data: { status: 'REPLIED' }
                    });

                    quoteResult = newQuote;
                    conversationLog.push({
                        role: 'AutoRFP Agent',
                        message: `✅ Quote extracted: $${Number(parsed.price).toFixed(2)}. Saved to database.`
                    });
                } else {
                    // ⚡ Incomplete — generate follow-up
                    const followUpPrompt = `
                        You are a professional procurement manager. A vendor replied but their email is unclear or missing pricing info.
                        Missing: ${JSON.stringify(parsed.missingInfo?.length ? parsed.missingInfo : ['total price'])}
                        Their email: """${vendorEmail}"""
                        
                        Write a short, polite follow-up asking for clarification (2-3 sentences only).
                    `;

                    const followUpModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
                    const followUpResult = await followUpModel.generateContent(followUpPrompt);
                    const followUpResponse = await followUpResult.response;
                    const followUpEmail = followUpResponse.text() || 'Could you please clarify your total pricing for this order?';
                    conversationLog.push({ role: 'AutoRFP Agent', message: followUpEmail });

                    lastMessage = followUpEmail;
                    isFollowUp = true;
                }
            }
        } catch (aiError: any) {
            console.warn('Gemini API failed during conversation simulation, providing detailed mock conversation:', aiError.message);

            // Generate a more robust mock conversation fallback
            const mockBasePrice = Math.floor(Math.random() * (1200 - 800) + 800);
            const deliveryFee = 25;
            const totalMockPrice = mockBasePrice + deliveryFee;

            conversationLog.push({
                role: rfp.distributor.name,
                message: `Hi, this is Mike from ${rfp.distributor.name}. I've reviewed your RFP for the bulk ingredient order. We can definitely fulfill the quantities you're looking for, especially the fresh produce and dry goods. 

Our current pricing for this specific batch is $${mockBasePrice.toFixed(2)}, plus a flat $${deliveryFee} delivery fee to your location at ${rfp.distributor.location}. Total comes to $${totalMockPrice.toFixed(2)}.

We have a truck in your area every Tuesday and Friday morning. Just let us know by 4 PM the day before if you want to lock this in. Thanks!`
            });

            conversationLog.push({
                role: 'AutoRFP Agent',
                message: `✅ Detailed quote extracted: $${totalMockPrice.toFixed(2)}. Saved to database. (Big Data Mock Fallback)`
            });

            const newQuote = await prisma.quote.create({
                data: {
                    rfpId,
                    price: totalMockPrice,
                    details: `Delivery: Tuesday/Friday Morning ($${deliveryFee} fee). | Full bulk order fulfillment confirmed for all ingredients. Pricing includes current market adjustment for fresh produce. | [Detailed Mock Fallback, Confidence: HIGH]`
                }
            });

            await prisma.rFP.update({
                where: { id: rfpId },
                data: { status: 'REPLIED' }
            });

            quoteResult = newQuote;
            turn = 1;
        }

        return NextResponse.json({
            success: !!quoteResult,
            turnsCompleted: turn,
            savedQuote: quoteResult,
            conversationLog,
            message: quoteResult
                ? `Quote of $${Number(quoteResult.price).toFixed(2)} captured after ${turn} turn(s).`
                : `Conversation completed ${turn} turns but no clear quote was extracted. Try manually.`
        });

    } catch (error: any) {
        console.error('Simulation error:', error);
        return NextResponse.json({ error: error.message || 'Simulation failed' }, { status: 500 });
    }
}
