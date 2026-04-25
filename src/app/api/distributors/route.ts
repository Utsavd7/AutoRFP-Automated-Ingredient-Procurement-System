import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Pool of 15 realistic food distributors ──────────────────────────────────
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

// Seeded Fisher-Yates: same location string → same 5 vendors every time
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

function generateMockEmail(name: string) {
    if (process.env.MOCK_EMAIL) return process.env.MOCK_EMAIL;
    const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `quotes+${clean}@autorfp.demo`;
}

// ─── Nominatim geocoding (free OpenStreetMap, no key needed) ─────────────────
async function geocode(location: string): Promise<{ lat: number; lon: number } | null> {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'AutoRFP-Procurement/1.0 (open-source demo)',
                'Accept-Language': 'en',
            },
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.length) return null;
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    } catch {
        return null;
    }
}

// ─── Overpass API (free OSM POI data, no key needed) ─────────────────────────
async function searchOverpass(lat: number, lon: number, location: string): Promise<{ name: string; location: string }[]> {
    const radius = 30000; // 30 km
    const query = `[out:json][timeout:12];
(
  nwr["shop"="wholesale"](around:${radius},${lat},${lon});
  nwr["office"~"company|logistics"]["name"~"food|wholesale|provisions|supply|distribut",i](around:${radius},${lat},${lon});
  nwr["industrial"="warehouse"]["name"~"food|wholesale|distribut|supply|provisions",i](around:${radius},${lat},${lon});
);
out body center 8;`;

    try {
        const res = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.timeout(14000),
        });
        if (!res.ok) return [];
        const data = await res.json();

        return (data.elements ?? [])
            .filter((el: any) => el.tags?.name)
            .slice(0, 5)
            .map((el: any) => {
                const t = el.tags;
                const addr = [t['addr:housenumber'], t['addr:street'], t['addr:city'] || location]
                    .filter(Boolean).join(' ');
                return { name: t.name as string, location: addr || location };
            });
    } catch {
        return [];
    }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    try {
        const { location } = await req.json();
        if (!location) {
            return NextResponse.json({ error: 'Please provide a location.' }, { status: 400 });
        }

        let candidates: { name: string; location: string; specialty?: string }[] = [];
        let dataSource = 'Mock Data';

        // 1. Try Nominatim geocoding → Overpass POI search (both free, no key)
        const coords = await geocode(location);
        if (coords) {
            const osmResults = await searchOverpass(coords.lat, coords.lon, location);
            if (osmResults.length > 0) {
                candidates = osmResults;
                dataSource = 'OpenStreetMap';
            }
        }

        // 2. Pad with seeded mock distributors if OSM returned fewer than 5
        const needed = 5 - candidates.length;
        if (needed > 0) {
            const picks = pickMockDistributors(location, needed + 3);
            for (const p of picks) {
                if (candidates.length >= 5) break;
                if (!candidates.find(c => c.name === p.name)) {
                    candidates.push({ name: p.name, location, specialty: p.specialty });
                }
            }
            if (dataSource === 'OpenStreetMap' && candidates.some(c => (c as any).specialty)) {
                dataSource = 'OpenStreetMap + Curated';
            }
        }

        // 3. Upsert to DB and attach email
        const savedDistributors = [];
        for (const d of candidates.slice(0, 5)) {
            const email = generateMockEmail(d.name);
            let dist = await prisma.distributor.findFirst({ where: { name: d.name, location: d.location } });
            if (!dist) {
                dist = await prisma.distributor.create({ data: { name: d.name, location: d.location, email } });
            }
            savedDistributors.push({ ...dist, specialty: d.specialty ?? null });
        }

        return NextResponse.json({ distributors: savedDistributors, source: dataSource });

    } catch (error: any) {
        console.error('Error finding distributors:', error);
        return NextResponse.json({ error: error.message || 'Failed to find distributors' }, { status: 500 });
    }
}
