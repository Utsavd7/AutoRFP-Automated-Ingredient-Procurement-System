import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { PrismaClient } from '@prisma/client';

const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

const prisma = new PrismaClient();

export async function POST(req: Request) {
    try {
        const { rfpId, emailBody } = await req.json();

        if (!ai) {
            return NextResponse.json(
                { error: 'Gemini API key is missing. Please add GEMINI_API_KEY to your .env file.' },
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
            where: { id: rfpId }
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
            
            Read the following email body and extract the total proposed price.
            
            Return ONLY a valid JSON object matching this TypeScript interface exactly:
            {
                "price": Number, // The total numeric price extracted. If they give a range, pick the average.
                "details": "String", // Any specific notes or conditions the vendor mentioned (e.g., "delivery on Tuesdays only", "chicken is out of stock"). Keep it brief.
                "confidence": "String" // "HIGH", "MEDIUM", or "LOW" depending on how clearly the price was stated.
            }
            
            Here is the email body from the vendor:
            """
            ${emailBody}
            """
        `;

        // Call Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
            }
        });

        const resultText = response.text;

        if (!resultText) {
            throw new Error("No response from Gemini.");
        }

        const parsedData = JSON.parse(resultText);

        if (!parsedData.price || isNaN(parsedData.price)) {
            return NextResponse.json({ error: 'The AI agent could not confidently extract a numeric price from the email.' }, { status: 400 });
        }

        // Save the quote and update the RFP status
        const newQuote = await prisma.quote.create({
            data: {
                rfpId,
                price: Number(parsedData.price),
                details: `[AI Parsed Confidence: ${parsedData.confidence}] ${parsedData.details || ''}`
            }
        });

        await prisma.rFP.update({
            where: { id: rfpId },
            data: { status: 'REPLIED' }
        });

        return NextResponse.json({
            success: true,
            extractedQuote: newQuote
        });

    } catch (error: any) {
        console.error('Error in AI Email Parsing Webhook:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to parse email and save quote.' },
            { status: 500 }
        );
    }
}
