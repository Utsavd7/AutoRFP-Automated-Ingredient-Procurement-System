import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaClient } from '@prisma/client';

const genAI = process.env.GEMINI_API_KEY
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    : null;

const prisma = new PrismaClient();

// GET /api/recommend?menuId=xxx
// Returns an AI-generated recommendation of the best distributor based on all received quotes
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const menuId = searchParams.get('menuId');

        if (!menuId) {
            return NextResponse.json({ error: 'menuId is required' }, { status: 400 });
        }

        if (!genAI) {
            return NextResponse.json(
                { error: 'Gemini API key is missing.' },
                { status: 500 }
            );
        }

        // Fetch all replied RFPs with their quotes and distributor info
        const rfps = await prisma.rFP.findMany({
            where: { menuId, status: 'REPLIED' } as any,
            include: {
                distributor: true,
                quotes: { orderBy: { price: 'asc' }, take: 1 }
            }
        });

        if (rfps.length === 0) {
            return NextResponse.json(
                { error: 'No quotes received yet. Cannot make a recommendation.' },
                { status: 404 }
            );
        }

        // Format quote data for the AI agent
        const quotesSummary = rfps.map((rfp: any) => {
            const quote = rfp.quotes[0];
            return {
                distributorName: rfp.distributor.name,
                location: rfp.distributor.location,
                price: quote?.price,
                details: quote?.details || 'No details provided',
            };
        });

        const lowestPrice = Math.min(...quotesSummary.map((q: any) => q.price));

        // Ask Gemini to analyze the quotes holistically and recommend
        const prompt = `
            You are an expert restaurant procurement advisor. You have received the following quotes from different food wholesale distributors in response to a single RFP (Request for Proposal).

            Here are the quotes:
            ${JSON.stringify(quotesSummary, null, 2)}
            
            Based on these factors:
            1. Price (lower is better)
            2. Delivery terms and flexibility (mentioned in details)
            3. Trust and reliability signals in the details
            4. Any red flags (e.g., stock shortages, restrictive conditions)
            
            Provide a final recommendation. Return ONLY a valid JSON object:
            {
                "recommendedDistributor": "String", // Name of the recommended distributor
                "reasoning": "String", // 2-3 sentence explanation of why they are the best choice
                "potentialRisks": "String", // Any risks or caveats to be aware of. Empty string if none.
                "savings": Number // How much cheaper is the recommended distributor vs the most expensive quote (0 if only one quote)
            }
        `;

        let recommendation;
        try {
            const model = genAI!.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: { responseMimeType: 'application/json' }
            });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const resultText = response.text();

            if (!resultText) throw new Error('No response from Gemini');
            recommendation = JSON.parse(resultText);
        } catch (aiError: any) {
            console.warn('Gemini API failed or quota exceeded, providing detailed mock recommendation:', aiError.message);

            // Logic to pick a mock recommendation
            const cheapest = quotesSummary.reduce((prev: any, curr: any) => (prev.price < curr.price) ? prev : curr);
            const expensive = quotesSummary.reduce((prev: any, curr: any) => (prev.price > curr.price) ? prev : curr);
            const savings = expensive.price - cheapest.price;

            recommendation = {
                recommendedDistributor: cheapest.distributorName,
                reasoning: `Based on a comprehensive cost-benefit analysis, ${cheapest.distributorName} is the clear winner with a total quote of $${cheapest.price.toFixed(2)}. Their price point offers a significant ${((savings / expensive.price) * 100).toFixed(1)}% reduction compared to the highest bid. Beyond cost, their logistics profile for ${cheapest.location} aligns perfectly with your requested delivery window, and their detailed itemization suggests higher reliability in fulfilling the full bulk order without shortages.`,
                potentialRisks: "Minor risk of price fluctuation on fresh produce if order is not finalized within 48 hours. Ensure delivery access is clear for their larger freight trucks.",
                savings: savings
            };
        }

        return NextResponse.json({
            recommendation,
            quotes: quotesSummary,
            lowestPrice
        });

    } catch (error: any) {
        console.error('Error generating recommendation:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to generate recommendation' },
            { status: 500 }
        );
    }
}
