import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { callOllama, callGroq, parseJSON } from '@/lib/llm';

const prisma = new PrismaClient();

type RecommendationResult = {
    recommendedDistributor: string;
    reasoning: string;
    potentialRisks: string;
    savings: number;
};

// GET /api/recommend?menuId=xxx
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const menuId = searchParams.get('menuId');
        if (!menuId) return NextResponse.json({ error: 'menuId is required' }, { status: 400 });

        const rfps = await prisma.rFP.findMany({
            where: { menuId, status: 'REPLIED' } as any,
            include: {
                distributor: true,
                quotes: { orderBy: { price: 'asc' }, take: 1 },
            },
        });

        if (rfps.length === 0) {
            return NextResponse.json({ error: 'No quotes received yet. Cannot make a recommendation.' }, { status: 404 });
        }

        const quotesSummary = rfps.map((rfp: any) => ({
            distributorName: rfp.distributor.name,
            location: rfp.distributor.location,
            price: rfp.quotes[0]?.price,
            details: rfp.quotes[0]?.details || 'No details provided',
        }));

        const menu = await prisma.menu.findUnique({
            where: { id: menuId },
            include: {
                recipes: {
                    include: {
                        ingredients: {
                            include: { pricingTrends: { orderBy: { date: 'desc' }, take: 1 } },
                        },
                    },
                },
            },
        } as any);

        const ingredientPricingMap = new Map<string, number>();
        for (const recipe of (menu as any)?.recipes ?? []) {
            for (const ing of recipe.ingredients) {
                if (ing.pricingTrends?.length > 0) {
                    const p = ing.pricingTrends[0].price;
                    ingredientPricingMap.set(ing.name, Math.max(ingredientPricingMap.get(ing.name) ?? 0, p));
                }
            }
        }
        const marketContext = ingredientPricingMap.size > 0
            ? `\nCurrent wholesale market prices:\n${Array.from(ingredientPricingMap.entries()).map(([n, p]) => `  - ${n}: $${p.toFixed(2)}/unit`).join('\n')}\nUse this to evaluate whether each vendor's quote is fair.`
            : '';

        const systemMsg = 'You are an expert restaurant procurement advisor. Return ONLY valid JSON, no markdown.';
        const userMsg = `Analyze these supplier quotes and recommend the best one.

Quotes:
${JSON.stringify(quotesSummary, null, 2)}
${marketContext}

Evaluate based on: price vs market rates, delivery terms, reliability signals, red flags.

Return ONLY this JSON:
{
  "recommendedDistributor": "String",
  "reasoning": "String",
  "potentialRisks": "String",
  "savings": Number
}`;

        const messages = [
            { role: 'system' as const, content: systemMsg },
            { role: 'user' as const, content: userMsg },
        ];

        // Run Ollama and Groq in parallel
        const [ollamaSettled, groqSettled] = await Promise.allSettled([
            callOllama(messages, true),
            callGroq(messages, true),
        ]);

        const ollamaRec = ollamaSettled.status === 'fulfilled'
            ? parseJSON<RecommendationResult>(ollamaSettled.value)
            : null;
        const groqRec = groqSettled.status === 'fulfilled'
            ? parseJSON<RecommendationResult>(groqSettled.value)
            : null;

        console.log('recommend: Ollama →', ollamaSettled.status, ollamaRec?.recommendedDistributor ?? 'no result');
        console.log('recommend: Groq   →', groqSettled.status, groqRec?.recommendedDistributor ?? 'no result');
        if (ollamaSettled.status === 'rejected') console.warn('Ollama recommend failed:', (ollamaSettled as any).reason?.message);
        if (groqSettled.status === 'rejected') console.warn('Groq recommend failed:', (groqSettled as any).reason?.message);

        // Cross-verify
        const agreed = !!(ollamaRec && groqRec &&
            ollamaRec.recommendedDistributor?.trim().toLowerCase() ===
            groqRec.recommendedDistributor?.trim().toLowerCase());
        const confidence = agreed ? 96 : (ollamaRec && groqRec ? 71 : 80);

        // Primary result: prefer Groq (higher quality), fall back to Ollama
        let recommendation: RecommendationResult | null = groqRec ?? ollamaRec;

        // If both AI models failed, compute a simple price-based fallback
        if (!recommendation) {
            const cheapest = quotesSummary.reduce((a: any, b: any) => a.price < b.price ? a : b);
            const expensive = quotesSummary.reduce((a: any, b: any) => a.price > b.price ? a : b);
            recommendation = {
                recommendedDistributor: cheapest.distributorName,
                reasoning: `${cheapest.distributorName} offers the lowest price at $${cheapest.price?.toFixed(2)}.`,
                potentialRisks: 'Verify delivery terms before committing.',
                savings: expensive.price - cheapest.price,
            };
        }

        return NextResponse.json({
            recommendation: {
                ...recommendation,
                verification: {
                    ollamaChoice: ollamaRec?.recommendedDistributor ?? null,
                    groqChoice: groqRec?.recommendedDistributor ?? null,
                    agreed,
                    confidence,
                },
            },
            quotes: quotesSummary,
            lowestPrice: Math.min(...quotesSummary.map((q: any) => q.price)),
        });

    } catch (error: any) {
        console.error('Error generating recommendation:', error);
        return NextResponse.json({ error: error.message || 'Failed to generate recommendation' }, { status: 500 });
    }
}
