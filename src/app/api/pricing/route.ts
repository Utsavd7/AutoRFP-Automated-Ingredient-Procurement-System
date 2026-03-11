import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// A simple mock pricing algorithm to simulate USDA/market wholesale data
// In a real scenario, this would call `https://api.nal.usda.gov/fdc/v1/...`
function generateMockPrice(ingredientName: string) {
    // Hash the string to get a deterministic but random-looking base price
    let hash = 0;
    for (let i = 0; i < ingredientName.length; i++) {
        hash = ingredientName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const basePrice = Math.abs(hash % 20) + 1.50; // between 1.50 and 21.50

    // Generate a trend (past 3 months + current)
    const trends = [];
    const now = new Date();

    for (let i = 3; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        // Add ±15% volatility
        const volatility = basePrice * (Math.random() * 0.3 - 0.15);
        trends.push({
            date: d.toISOString(),
            price: Number((basePrice + volatility).toFixed(2)),
            source: 'USDA Simulated'
        });
    }

    return trends;
}

export async function POST(req: Request) {
    try {
        const { ingredients } = await req.json();

        if (!ingredients || !Array.isArray(ingredients)) {
            return NextResponse.json({ error: 'Missing ingredients array' }, { status: 400 });
        }

        const pricingResults = [];

        for (const ing of ingredients) {
            if (!ing.name) continue;

            // 1. Check if we already have recent pricing for this ingredient ID in our DB
            let trends = [];
            const existingTrends = await prisma.pricingTrend.findMany({
                where: { ingredientId: ing.id },
                orderBy: { date: 'asc' },
            });

            if (existingTrends.length > 0 && new Date(existingTrends[existingTrends.length - 1].date).getMonth() === new Date().getMonth()) {
                // Use existing data from DB
                trends = existingTrends.map((t: any) => ({
                    date: t.date.toISOString(),
                    price: t.price,
                    source: t.source
                }));
            } else {
                // 2. Fetch/Generate new fake USDA data
                const generatedTrends = generateMockPrice(ing.name);

                // 3. STORE IT IN THE DATABASE (Must-have requirement)
                if (ing.id) {
                    await prisma.pricingTrend.createMany({
                        data: generatedTrends.map(t => ({
                            ingredientId: ing.id,
                            price: t.price,
                            date: new Date(t.date),
                            source: t.source
                        }))
                    });
                }
                trends = generatedTrends;
            }

            pricingResults.push({
                name: ing.name,
                id: ing.id,
                currentPrice: trends[trends.length - 1].price,
                unit: 'per lb',
                history: trends
            });
        }

        return NextResponse.json({ pricing: pricingResults });

    } catch (error: any) {
        console.error('Error fetching pricing:', error);
        return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 });
    }
}
