import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const openai = process.env.GROQ_API_KEY
    ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
    : null;

const prisma = new PrismaClient();

export async function POST(req: Request) {
    try {
        const { rfpId, emailBody } = await req.json();

        if (!openai) {
            return NextResponse.json(
                { error: 'Groq API key is missing. Please add GROQ_API_KEY to your .env file.' },
                { status: 500 }
            );
        }

        if (!rfpId || !emailBody) {
            return NextResponse.json(
                { error: 'Missing rfpId or emailBody in request.' },
                { status: 400 }
            );
        }

        // Verify RFP exists and hasn't already been replied to
        const rfp = await prisma.rFP.findUnique({
            where: { id: rfpId },
            include: { distributor: true }
        });

        if (!rfp) {
            return NextResponse.json({ error: 'RFP not found.' }, { status: 404 });
        }

        if (rfp.status === 'REPLIED') {
            return NextResponse.json({ error: 'A quote has already been submitted for this RFP.' }, { status: 400 });
        }

        // Agent Prompt to extract Quote details
        const prompt = `
            You are an expert AI procurement agent. Your job is to parse incoming emails from food wholesale vendors who are replying to a Request For Proposal (RFP) for ingredients.
            
            Read the following email body and extract EVERYTHING you can.
            
            Return ONLY a valid JSON object matching this TypeScript interface exactly:
            {
                "price": Number | null, // The total numeric price extracted. Null if no clear price found.
                "deliveryTerms": "String", // Delivery frequency, lead time, or conditions mentioned. Empty string if not mentioned.
                "details": "String", // Other specific notes or conditions. E.g. "chicken out of stock until next week". Empty string if none.
                "confidence": "String", // "HIGH", "MEDIUM", or "LOW" depending on how clearly the price was stated.
                "missingInfo": ["String"] // List of important missing pieces needed to make a decision. E.g. ["delivery schedule", "minimum order quantity"]. Empty array if nothing is missing.
            }
            
            Here is the email body from the vendor:
            """
            \${emailBody}
            """
        `;

        // Call Groq
        let parsed;
        try {
            const response = await openai.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            });

            const resultText = response.choices[0].message.content;
            if (!resultText) throw new Error("No response from Groq.");

            parsed = JSON.parse(resultText);
        } catch (aiError: any) {
            console.error("Groq Parsing Error:", aiError);
            throw aiError;
        }

        // AUTONOMOUS BACK-AND-FORTH:
        // If no clear price was found, generate and return a follow-up email instead of saving a quote
        if (!parsed.price || isNaN(Number(parsed.price)) || parsed.confidence === 'LOW') {
            const followUpPrompt = `
                You are a professional procurement manager at a restaurant group. 
                A vendor replied to an RFP but their email was unclear or missing key information.
                
                Missing information identified: \${JSON.stringify(parsed.missingInfo?.length ? parsed.missingInfo : ['total price', 'delivery terms'])}
                Original email: """\${emailBody}"""
                
                Write a short, polite, professional follow-up email (3-4 sentences max) asking them to clarify the missing details.
                Return ONLY the email body text, nothing else. No subject line. No "Dear..." opener needed.
            `;

            const followUpResponse = await openai.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: followUpPrompt }]
            });

            const followUpEmail = followUpResponse.choices[0].message.content || 'Could you please clarify your total pricing and delivery terms for this order?';

            // Log the follow-up (in production this would be sent via SMTP/Resend)
            console.log(`\n📧 AUTONOMOUS FOLLOW-UP EMAIL to \${rfp.distributor.email}:\n\${followUpEmail}\n`);

            return NextResponse.json({
                success: false,
                action: 'FOLLOW_UP_SENT',
                followUpEmail,
                missingInfo: parsed.missingInfo,
                message: `Quote was incomplete. A follow-up was automatically generated and logged.`
            });
        }

        // Save the complete quote and update the RFP status
        const details = [
            parsed.deliveryTerms ? `Delivery: ${parsed.deliveryTerms}` : '',
            parsed.details ? parsed.details : '',
            `[AI Confidence: ${parsed.confidence}]`
        ].filter(Boolean).join(' | ');

        const newQuote = await prisma.quote.create({
            data: {
                rfpId,
                price: Number(parsed.price),
                details: details
            }
        });

        await prisma.rFP.update({
            where: { id: rfpId },
            data: { status: 'REPLIED' }
        });

        return NextResponse.json({
            success: true,
            action: 'QUOTE_SAVED',
            extractedQuote: newQuote,
            parsed
        });

    } catch (error: any) {
        console.error('Error in AI Email Parsing Webhook:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to parse email and save quote.' },
            { status: 500 }
        );
    }
}
