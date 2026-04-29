import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Pool of 15 realistic food distributors (last resort only) ───────────────
const MOCK_POOL = [
    { name: 'Sysco Distribution Hub',         specialty: 'Full-line broadline distributor' },
    { name: 'US Foods Regional Center',        specialty: 'Fresh, frozen & dry goods' },
    { name: 'Gordon Food Service',             specialty: 'Restaurant supplies & produce' },
    { name: 'Performance Food Group (PFG)',    specialty: 'Fresh proteins & dairy' },
    { name: 'Reinhart Foodservice',            specialty: 'Specialty & ethnic ingredients' },
    { name: 'Ben E. Keith Foods',              specialty: 'Premium proteins & dry goods' },
    { name: 'Nicholas & Company',              specialty: 'Fresh produce specialist' },
    { name: 'Shamrock Foods Company',          specialty: 'Dairy, bakery & desserts' },
    { name: "Chef's Warehouse",                specialty: 'Artisan & specialty imports' },
    { name: 'Baldor Specialty Foods',          specialty: 'Organic & farm-direct produce' },
    { name: 'Roma Food Enterprises',           specialty: 'Italian & Mediterranean imports' },
    { name: 'Heritage Food Group',             specialty: 'Sustainable & local sourcing' },
    { name: 'Summit Provisions Co.',           specialty: 'Bulk dry goods & pantry staples' },
    { name: 'Pacific Coast Distributors',      specialty: 'Seafood & Asian specialty items' },
    { name: 'Imperial Fresh Market Supply',    specialty: 'Farm-direct produce & herbs' },
];

function pickMockDistributors(location: string, count = 5) {
    let seed = 5381;
    for (let i = 0; i < location.length; i++) {
        seed = ((seed << 5) + seed) ^ location.charCodeAt(i);
        seed = seed & 0x7fffffff;
    }
    const lcg = () => {
        seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
        return seed;
    };
    const pool = [...MOCK_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = lcg() % (i + 1);
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
}

const KNOWN_DOMAINS: [string, string][] = [
    ['sysco',             'orders@sysco.com'],
    ['us foods',          'rfp@usfoods.com'],
    ['gordon food',       'procurement@gfs.com'],
    ['performance food',  'sales@pfgc.com'],
    ['reinhart',          'procurement@reinhartfoodservice.com'],
    ['ben e. keith',      'orders@benekeith.com'],
    ['nicholas',          'info@nicholasandco.com'],
    ['shamrock',          'orders@shamrockfoods.com'],
    ["chef's warehouse",  'sales@chefswarehouse.com'],
    ['baldor',            'orders@baldorfood.com'],
    ['restaurant depot',  'wholesale@restaurantdepot.com'],
];

function generateEmail(name: string) {
    if (process.env.MOCK_EMAIL) return process.env.MOCK_EMAIL;
    const lower = name.toLowerCase();
    for (const [key, email] of KNOWN_DOMAINS) {
        if (lower.includes(key)) return email;
    }
    // Generate a professional domain from the business name
    const words = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/);
    const domain = words.slice(0, 2).join('').slice(0, 20);
    return `procurement@${domain}.com`;
}

// ─── Google Places Text Search ────────────────────────────────────────────────
async function searchGooglePlaces(location: string): Promise<{ name: string; location: string }[]> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return [];

    const queries = [
        `food distributor wholesale near ${location}`,
        `restaurant food supply wholesale near ${location}`,
    ];

    const seen = new Set<string>();
    const results: { name: string; location: string }[] = [];

    for (const query of queries) {
        if (results.length >= 8) break;
        try {
            const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) continue;
            const data = await res.json();
            if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
                console.error('Google Places error:', data.status, data.error_message);
                continue;
            }
            for (const place of data.results ?? []) {
                if (seen.has(place.place_id)) continue;
                seen.add(place.place_id);
                results.push({ name: place.name, location: place.formatted_address ?? location });
            }
        } catch (err) {
            console.error('Google Places fetch error:', err);
        }
    }

    return results;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    try {
        const { location } = await req.json();
        if (!location) {
            return NextResponse.json({ error: 'Please provide a location.' }, { status: 400 });
        }

        let candidates: { name: string; location: string; specialty?: string }[] = [];
        let dataSource = 'Curated';

        // 1. Try Google Places API (uses GOOGLE_MAPS_API_KEY)
        const googleResults = await searchGooglePlaces(location);
        if (googleResults.length > 0) {
            candidates = googleResults;
            dataSource = 'Google Places';
        }

        // 2. Fall back to curated mock pool only if Google Places returns nothing
        if (candidates.length === 0) {
            const picks = pickMockDistributors(location, 5);
            candidates = picks.map(p => ({ name: p.name, location, specialty: p.specialty }));
        }

        // 3. Save to DB — always update email so stale records get fixed
        const savedDistributors = [];
        for (const d of candidates.slice(0, 5)) {
            const email = generateEmail(d.name);
            const existing = await prisma.distributor.findFirst({ where: { name: d.name, location: d.location } });
            const dist = existing
                ? await prisma.distributor.update({ where: { id: existing.id }, data: { email } })
                : await prisma.distributor.create({ data: { name: d.name, location: d.location, email } });
            savedDistributors.push({ ...dist, specialty: d.specialty ?? null });
        }

        return NextResponse.json({ distributors: savedDistributors, source: dataSource });

    } catch (error: any) {
        console.error('Error finding distributors:', error);
        return NextResponse.json({ error: error.message || 'Failed to find distributors' }, { status: 500 });
    }
}
