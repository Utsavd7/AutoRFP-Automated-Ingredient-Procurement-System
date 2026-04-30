import { NextResponse } from 'next/server';
import { ingestQuote } from '@/lib/chroma';
import { getEmbedding } from '@/lib/embeddings';
import { makeTenantId } from '@/lib/tenant';

const demoTenantId = makeTenantId('demo@autorfp.local', 'Demo Bistro Group');

const memories = [
    {
        id: 'demo-memory-century-proteins',
        supplier: 'Century Wholesale',
        location: 'New York, NY',
        price: 18420,
        ingredients: 'beef, chicken, butter, romaine, mushrooms',
        text: 'Procurement decision: Century Wholesale won a New York bistro basket after reducing protein and dairy pricing from $20,560 to $18,420. Decision: ACCEPT. Strong deal quality, fast response, best leverage on beef and butter.',
    },
    {
        id: 'demo-memory-baldor-produce',
        supplier: 'Baldor Specialty Foods',
        location: 'Bronx, NY',
        price: 14180,
        ingredients: 'salmon, apples, greens, rigatoni, turkey',
        text: 'Procurement decision: Baldor Specialty Foods won a mixed produce and seafood order at $14,180 after counter-offer. Decision: ACCEPT. Best delivery reliability and produce pricing; salmon remained the largest market risk.',
    },
    {
        id: 'demo-memory-usfoods-counter',
        supplier: 'US Foods Metro',
        location: 'Jersey City, NJ',
        price: 20900,
        ingredients: 'beef, dairy, dry goods, chicken',
        text: 'Procurement decision: US Foods Metro required counter-offer after quoting above market on proteins. Decision: COUNTER. Useful coverage, but lower price competitiveness than Century Wholesale on beef and dairy.',
    },
];

export async function POST() {
    const results = await Promise.all(memories.map(async memory => {
        const embedding = await getEmbedding(memory.text);
        if (!embedding) return false;
        return ingestQuote({
            id: memory.id,
            text: memory.text,
            embedding,
            metadata: {
                tenantId: demoTenantId,
                distributorName: memory.supplier,
                location: memory.location,
                price: memory.price,
                ingredients: memory.ingredients,
                timestamp: new Date().toISOString(),
            },
        });
    }));

    const seeded = results.filter(Boolean).length;
    return NextResponse.json({
        ok: true,
        seeded,
        skipped: memories.length - seeded,
        message: seeded ? 'Demo RAG memories seeded.' : 'Chroma unavailable; demo continues without vector memory.',
    });
}
