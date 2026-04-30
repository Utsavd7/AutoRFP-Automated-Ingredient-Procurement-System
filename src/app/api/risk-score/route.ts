import { NextResponse } from 'next/server';

interface Quote {
    distributorName: string;
    distributorLocation: string;
    price: number;
    details?: string;
}

interface PricingItem {
    name: string;
    currentPrice: number;
}

interface Ingredient {
    name: string;
    quantity: number;
    unit: string;
}

// Reliability: inferred from quote details quality
function scoreReliability(details = ''): number {
    let score = 20;
    const d = details.toLowerCase();
    if (d.includes('delivery') || d.includes('deliver')) score += 22;
    if (/monday|tuesday|wednesday|thursday|friday|weekly|daily/.test(d)) score += 20;
    if (details.length > 80) score += 18;
    if (/guaranteed|confirmed|commit/.test(d)) score += 20;
    return Math.min(100, score);
}

// Coverage: how complete the quote is relative to the order
function scoreCoverage(details = '', ingredientCount: number): number {
    let score = 25;
    const d = details.toLowerCase();
    if (!/not available|cannot supply|out of stock|partial/.test(d)) score += 25;
    if (details.length > 100) score += 20;
    if (ingredientCount > 4) score += 15;
    if (/full order|all items|complete/.test(d)) score += 15;
    return Math.min(100, score);
}

export async function POST(req: Request) {
    try {
        const { quotes, pricingData = [], ingredients = [] } = await req.json() as {
            quotes: Quote[];
            pricingData: PricingItem[];
            ingredients: Ingredient[];
        };

        if (!quotes?.length) return NextResponse.json({ scores: [] });

        const prices = quotes.map(q => Number(q.price));
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice;

        // Compute market total from real pricing data
        const priceMap = new Map(pricingData.map(p => [p.name.toLowerCase(), p.currentPrice]));
        const marketTotal = ingredients.reduce((sum, ing) => {
            const p = priceMap.get(ing.name.toLowerCase()) ?? 0;
            return sum + (typeof ing.quantity === 'number' ? p * ing.quantity : p);
        }, 0);

        const scores = quotes.map((q, idx) => {
            const price = Number(q.price);

            // Price Competitiveness: best = 100, worst = 20, interpolated
            const priceScore = priceRange > 0
                ? Math.round(20 + ((maxPrice - price) / priceRange) * 80)
                : 75;

            // Reliability from quote detail content
            const reliabilityScore = scoreReliability(q.details);

            // Response Speed: proxy from position (first to respond = fastest)
            const speedScore = Math.max(50, Math.round(100 - idx * 14));

            // Market Alignment: how close to fair wholesale market price
            const marketScore = marketTotal > 0
                ? Math.round(Math.max(0, Math.min(100, 100 - (Math.abs(price - marketTotal) / marketTotal) * 120)))
                : 68;

            // Coverage: quote completeness
            const coverageScore = scoreCoverage(q.details, ingredients.length);

            const overall = Math.round(
                priceScore * 0.30 +
                reliabilityScore * 0.20 +
                speedScore * 0.15 +
                marketScore * 0.20 +
                coverageScore * 0.15
            );

            return {
                distributorName: q.distributorName,
                location: q.distributorLocation,
                price,
                overall,
                axes: [
                    { axis: 'Price',        score: priceScore },
                    { axis: 'Reliability',  score: reliabilityScore },
                    { axis: 'Speed',        score: speedScore },
                    { axis: 'Market Rate',  score: marketScore },
                    { axis: 'Coverage',     score: coverageScore },
                ],
            };
        });

        scores.sort((a, b) => b.overall - a.overall);

        return NextResponse.json({ scores });
    } catch (err: any) {
        console.error('[risk-score]', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
