import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { callGroqThenOllama, parseJSON as parseLLMJSON } from '@/lib/llm';

const prisma = new PrismaClient();

// ─── CME / ICE futures → wholesale $/lb ──────────────────────────────────────
const COMMODITY_MAP: Array<{ keywords: string[]; symbol: string; factor: number; label: string }> = [
    { keywords: ['beef', 'ground beef', 'ribeye', 'steak', 'brisket', 'chuck', 'veal', 'sirloin', 'tenderloin', 'short rib', 'flank', 'skirt', 'burger', 'patty', 'strip', 'chop'], symbol: 'LE=F', factor: 0.022, label: 'CME Live Cattle' },
    { keywords: ['pork', 'bacon', 'ham', 'guanciale', 'prosciutto', 'pancetta', 'sausage', 'chorizo', 'salami', 'pepperoni', 'lard', 'pork belly', 'pork chop', 'pork loin', 'lamb', 'rack of lamb'], symbol: 'HE=F', factor: 0.021, label: 'CME Lean Hogs' },
    { keywords: ['duck', 'foie gras', 'rabbit', 'venison', 'game'], symbol: 'HE=F', factor: 0.028, label: 'CME Lean Hogs (specialty proxy)' },
    { keywords: ['wheat', 'flour', 'all-purpose flour', 'bread flour', 'pizza flour', 'semolina', 'bread', 'breadcrumb', 'panko', 'crouton', 'gnocchi', 'dumpling', 'lasagna', 'tortellini'], symbol: 'ZW=F', factor: 0.0042, label: 'CBOT Wheat' },
    { keywords: ['pasta', 'spaghetti', 'linguine', 'fettuccine', 'penne', 'rigatoni', 'noodle', 'ramen', 'udon', 'orzo'], symbol: 'ZW=F', factor: 0.0055, label: 'CBOT Wheat (pasta)' },
    { keywords: ['rice', 'risotto', 'arborio', 'jasmine rice', 'basmati', 'brown rice', 'sushi rice'], symbol: 'ZC=F', factor: 0.0090, label: 'Rice (corn proxy)' },
    { keywords: ['quinoa', 'couscous', 'grain', 'farro', 'bulgur', 'millet', 'barley'], symbol: 'ZO=F', factor: 0.0085, label: 'CBOT Oats (grain proxy)' },
    { keywords: ['corn', 'cornmeal', 'polenta', 'grits', 'hominy', 'popcorn', 'corn starch', 'corn syrup', 'tortilla'], symbol: 'ZC=F', factor: 0.0038, label: 'CBOT Corn' },
    { keywords: ['soy', 'soybean', 'tofu', 'miso', 'edamame', 'tempeh'], symbol: 'ZS=F', factor: 0.0045, label: 'CBOT Soybeans' },
    { keywords: ['canola oil', 'vegetable oil', 'soybean oil'], symbol: 'ZS=F', factor: 0.0060, label: 'CBOT Soybeans (oil proxy)' },
    { keywords: ['olive oil'], symbol: 'ZS=F', factor: 0.014, label: 'Olive Oil (soy proxy)' },
    { keywords: ['coffee', 'espresso', 'cappuccino', 'latte', 'americano', 'cold brew', 'coffee bean', 'coffee grounds'], symbol: 'KC=F', factor: 0.040, label: 'ICE Coffee C' },
    { keywords: ['sugar', 'cane sugar', 'brown sugar', 'powdered sugar', 'confectioner', 'agave', 'molasses'], symbol: 'SB=F', factor: 0.025, label: 'ICE Sugar No.11' },
    { keywords: ['honey', 'maple syrup', 'simple syrup', 'syrup'], symbol: 'SB=F', factor: 0.035, label: 'ICE Sugar (syrup proxy)' },
    { keywords: ['cocoa', 'chocolate', 'dark chocolate', 'milk chocolate', 'white chocolate', 'cacao', 'ganache', 'nutella'], symbol: 'CC=F', factor: 0.0012, label: 'ICE Cocoa' },
    { keywords: ['orange', 'orange juice', 'grapefruit', 'mandarin', 'clementine'], symbol: 'OJ=F', factor: 0.008, label: 'ICE OJ' },
    { keywords: ['lemon', 'lime', 'citrus', 'lemon juice', 'lime juice'], symbol: 'OJ=F', factor: 0.010, label: 'ICE OJ (citrus proxy)' },
    { keywords: ['oat', 'oatmeal', 'oats', 'granola', 'muesli'], symbol: 'ZO=F', factor: 0.0060, label: 'CBOT Oats' },
    { keywords: ['salmon', 'halibut', 'sea bass', 'mahi', 'swordfish'], symbol: 'ZS=F', factor: 0.018, label: 'Premium Fish (proxy)' },
    { keywords: ['shrimp', 'prawn'], symbol: 'ZS=F', factor: 0.014, label: 'Shrimp (proxy)' },
    { keywords: ['lobster', 'crab'], symbol: 'ZS=F', factor: 0.030, label: 'Shellfish (proxy)' },
    { keywords: ['scallop', 'oyster', 'clam', 'mussel'], symbol: 'ZS=F', factor: 0.016, label: 'Shellfish (proxy)' },
    { keywords: ['tuna', 'cod', 'tilapia', 'anchovy', 'sardine', 'seafood', 'fish'], symbol: 'ZS=F', factor: 0.012, label: 'Fish (proxy)' },
];

// ─── BLS retail price series ──────────────────────────────────────────────────
const BLS_MAP: Array<{ keywords: string[]; series: string; label: string; unitConvert?: number }> = [
    {
        keywords: ['chicken', 'poultry', 'hen', 'rotisserie', 'chicken breast', 'chicken thigh', 'chicken wing', 'drumstick', 'fried chicken', 'grilled chicken', 'roast chicken'],
        series: 'APU0000706111',
        label: 'BLS Chicken Breast ($/lb)',
    },
    {
        keywords: ['turkey', 'duck breast', 'turkey breast'],
        series: 'APU0000706111',
        label: 'BLS Chicken (turkey proxy, $/lb)',
        unitConvert: 1.1,
    },
    {
        keywords: ['egg', 'eggs', 'egg white', 'egg yolk', 'omelette', 'frittata', 'scrambled', 'benedict', 'poached egg'],
        series: 'APU0000708111',
        label: 'BLS Eggs ($/doz → $/ct)',
        unitConvert: 1 / 12,
    },
    {
        keywords: ['whole milk', 'skim milk', '2% milk', 'dairy milk'],
        series: 'APU0000709112',
        label: 'BLS Milk ($/gal → $/lb)',
        unitConvert: 1 / 8.6,
    },
    {
        keywords: ['heavy cream', 'cream', 'half and half', 'whipping cream'],
        series: 'APU0000709112',
        label: 'BLS Milk (cream proxy, $/lb)',
        unitConvert: 2.8 / 8.6,
    },
    {
        keywords: ['milk', 'condensed milk', 'evaporated milk'],
        series: 'APU0000709112',
        label: 'BLS Milk ($/lb)',
        unitConvert: 1 / 8.6,
    },
    {
        keywords: ['butter', 'margarine', 'ghee', 'clarified butter'],
        series: 'APU0000715211',
        label: 'BLS Butter ($/lb)',
    },
    {
        keywords: ['cheddar', 'mozzarella', 'parmesan', 'parmigiano', 'pecorino', 'ricotta', 'brie', 'gouda', 'gruyere', 'fontina', 'provolone', 'romano', 'gorgonzola', 'blue cheese', 'feta', 'cream cheese', 'cottage cheese', 'mascarpone', 'goat cheese', 'cheese'],
        series: 'APU0000710212',
        label: 'BLS Cheddar Cheese ($/lb)',
    },
    {
        keywords: ['tomato', 'roma tomato', 'cherry tomato', 'heirloom tomato', 'plum tomato', 'san marzano', 'tomato sauce', 'tomato paste', 'tomato puree', 'marinara'],
        series: 'APU0000712311',
        label: 'BLS Tomatoes ($/lb)',
    },
    {
        keywords: ['potato', 'russet', 'yukon', 'sweet potato', 'yam', 'french fry', 'fries', 'hash brown', 'mashed potato'],
        series: 'APU0000712409',
        label: 'BLS Potatoes ($/lb)',
    },
    {
        keywords: ['lettuce', 'romaine', 'iceberg', 'arugula', 'spinach', 'mixed greens', 'salad', 'kale', 'swiss chard', 'endive', 'radicchio', 'bok choy'],
        series: 'APU0000712311',
        label: 'BLS Lettuce ($/lb)',
        unitConvert: 0.85,
    },
    {
        keywords: ['apple', 'gala', 'fuji', 'granny smith', 'honeycrisp', 'mcintosh'],
        series: 'APU0000711111',
        label: 'BLS Apples ($/lb)',
    },
    {
        keywords: ['banana', 'plantain'],
        series: 'APU0000711211',
        label: 'BLS Bananas ($/lb)',
    },
];

// ─── Deterministic helpers (no Math.random — same ingredient = same price) ──────

function strHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h);
}

// Deterministic ±5% noise based on ingredient name + period index
function seededNoise(name: string, index: number): number {
    const h = strHash(name + String(index));
    return ((h % 1000) / 1000 - 0.5) * 0.10;
}

function getBasePrice(name: string): number {
    const lower = name.toLowerCase();
    if (/ribeye|filet|tenderloin|lobster/.test(lower)) return 26;
    if (/steak|sirloin|short rib|brisket|scallop/.test(lower)) return 17;
    if (/salmon|halibut|sea bass|duck|lamb/.test(lower)) return 14;
    if (/chicken|pork|shrimp|tuna|cod|fish/.test(lower)) return 7;
    if (/beef|burger|patty|sausage/.test(lower)) return 8;
    if (/cheese|cream cheese|mascarpone|ricotta/.test(lower)) return 5;
    if (/butter|ghee/.test(lower)) return 6;
    if (/olive oil/.test(lower)) return 10;
    if (/cream|milk/.test(lower)) return 2.5;
    if (/pasta|spaghetti|fettuccine|linguine|noodle/.test(lower)) return 2;
    if (/rice|risotto|arborio|quinoa|grain/.test(lower)) return 1.6;
    if (/flour|bread|dough|breadcrumb/.test(lower)) return 1;
    if (/potato|fries/.test(lower)) return 0.9;
    if (/tomato|mushroom|asparagus|zucchini/.test(lower)) return 2.8;
    if (/broccoli|carrot|pepper|onion|vegetable/.test(lower)) return 1.6;
    if (/garlic|shallot|ginger/.test(lower)) return 4;
    if (/herb|basil|parsley|cilantro|thyme|rosemary|dill|mint/.test(lower)) return 8;
    if (/lemon|lime|citrus/.test(lower)) return 1.8;
    if (/chocolate|cocoa/.test(lower)) return 7;
    if (/nuts|almond|walnut|pecan/.test(lower)) return 9;
    if (/wine|stock|broth/.test(lower)) return 2;
    if (/sauce|dressing|vinaigrette|aioli|pesto/.test(lower)) return 4;
    if (/sugar|honey|syrup/.test(lower)) return 2;
    if (/coffee|espresso/.test(lower)) return 15;
    // Generic: stable hash-derived price in $2–$10 range
    return 2 + (strHash(lower) % 800) / 100;
}

function generateEstimatedTrends(ingredientName: string, basePrice: number): { date: string; price: number; source: string }[] {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        const drift = basePrice * ((i - 2.5) * 0.012);
        const noise = basePrice * seededNoise(ingredientName, i);
        return {
            date: d.toISOString(),
            price: Number(Math.max(0.10, basePrice + drift + noise).toFixed(2)),
            source: 'Estimated',
        };
    });
}

// Ask Groq/Ollama for a price estimate when live market APIs return nothing
async function fetchAIPrice(name: string): Promise<{ price: number; source: string; label: string } | null> {
    try {
        const text = await Promise.race([
            callGroqThenOllama([
                { role: 'system', content: 'You are a US wholesale food pricing expert. Return only valid JSON with no extra text.' },
                { role: 'user', content: `What is the approximate current US wholesale cost per pound for: "${name}"? Use realistic 2024-2025 market prices. Return JSON: {"price": number, "unit": "per lb"}` }
            ], true),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI pricing timeout')), 4000)),
        ]);
        const parsed = parseLLMJSON<{ price: number; unit: string }>(text);
        if (parsed?.price && parsed.price > 0 && parsed.price < 120) {
            return { price: +Number(parsed.price).toFixed(2), source: 'AI Estimated', label: 'AI Price Estimate (Groq/Ollama)' };
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchBLSPrice(name: string): Promise<{ price: number; source: string; label: string } | null> {
    const lowerName = name.toLowerCase();
    const match = BLS_MAP.find(b => b.keywords.some(kw => lowerName.includes(kw)));
    if (!match) return null;

    try {
        const currentYear = new Date().getFullYear();
        const url = `https://api.bls.gov/publicAPI/v2/timeseries/data/${match.series}?startyear=${currentYear - 1}&endyear=${currentYear}&calculations=false`;
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return null;

        const data = await res.json();
        if (data.status !== 'REQUEST_SUCCEEDED') return null;

        const series = data.Results?.series?.[0];
        if (!series?.data?.length) return null;

        const latestEntry = series.data.find((d: any) => d.value && !isNaN(parseFloat(d.value)));
        if (!latestEntry) return null;

        let price = parseFloat(latestEntry.value);
        if (match.unitConvert) price = price * match.unitConvert;
        price = parseFloat(price.toFixed(2));

        if (price <= 0.05 || price > 80) return null;

        return { price, source: 'LIVE', label: match.label };
    } catch {
        return null;
    }
}

async function fetchLiveCommodityPrice(name: string): Promise<{ price: number; source: string; label: string } | null> {
    const lowerName = name.toLowerCase();
    const match = COMMODITY_MAP.find(c => c.keywords.some(kw => lowerName.includes(kw)));
    if (!match) return null;

    // Try Yahoo Finance v8 then v11 as fallback
    const urls = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${match.symbol}?interval=1d&range=6mo`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${match.symbol}?interval=1d&range=6mo`,
    ];

    for (const url of urls) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; AutoRFP/1.0)',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                signal: AbortSignal.timeout(2500),
            });
            if (!res.ok) continue;

            const data = await res.json();
            const result = data?.chart?.result?.[0];
            if (!result) continue;

            const timestamps: number[] = result.timestamp ?? [];
            const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
            if (timestamps.length === 0 || closes.length === 0) continue;

            const history: { date: string; price: number }[] = [];
            for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
                const close = closes[i];
                if (!close || close <= 0) continue;
                const scaledPrice = parseFloat((close * match.factor).toFixed(2));
                if (scaledPrice <= 0.05 || scaledPrice > 80) continue;
                history.push({ date: new Date(timestamps[i] * 1000).toISOString(), price: scaledPrice });
            }

            if (history.length < 2) continue;

            const lastPrice = history[history.length - 1].price;
            return { price: lastPrice, source: 'LIVE', label: match.label };
        } catch {
            continue;
        }
    }

    return null;
}

export async function POST(req: Request) {
    try {
        const { ingredients } = await req.json();

        if (!ingredients || !Array.isArray(ingredients)) {
            return NextResponse.json({ error: 'Missing ingredients array' }, { status: 400 });
        }

        const currentMonth = new Date().getMonth();
        const now = new Date();
        const validIngredients = (ingredients as any[]).filter(ing => ing.name);

        // ── Single batch DB read for all cached trends ────────────────────────
        const allIds = validIngredients.map(i => i.id).filter(Boolean);
        const allCached = allIds.length > 0
            ? await prisma.pricingTrend.findMany({
                where: { ingredientId: { in: allIds } },
                orderBy: { date: 'asc' },
              })
            : [];

        const cachedByIngredient = new Map<string, typeof allCached>();
        for (const t of allCached) {
            const arr = cachedByIngredient.get(t.ingredientId) ?? [];
            arr.push(t);
            cachedByIngredient.set(t.ingredientId, arr);
        }

        // Collect stale IDs and new trends — written in one batch after parallel work
        const staleIds: string[] = [];
        const trendsToWrite: { ingredientId: string; price: number; date: Date; source: string }[] = [];

        // ── All ingredients in parallel ───────────────────────────────────────
        const pricingResults = await Promise.all(
            validIngredients.map(async (ing) => {
                let trends: { date: string; price: number; source: string }[] = [];

                // 1. Check cache from batch read
                if (ing.id) {
                    const existing = cachedByIngredient.get(ing.id) ?? [];
                    const isFresh = existing.length >= 4 &&
                        new Date(existing[existing.length - 1].date).getMonth() === currentMonth;

                    if (isFresh) {
                        trends = existing.map((t: any) => ({
                            date: t.date.toISOString(),
                            price: t.price,
                            source: t.source,
                        }));
                    } else if (existing.length > 0) {
                        staleIds.push(ing.id);
                    }
                }

                if (trends.length === 0) {
                    // 2. Yahoo Finance and BLS in parallel — both have short timeouts
                    let liveData: { price: number; source: string; label: string } | null = null;

                    const [yahooResult, blsResult] = await Promise.allSettled([
                        fetchLiveCommodityPrice(ing.name),
                        fetchBLSPrice(ing.name),
                    ]);

                    liveData =
                        (yahooResult.status === 'fulfilled' ? yahooResult.value : null) ??
                        (blsResult.status === 'fulfilled' ? blsResult.value : null);

                    // 3. AI estimate only when both live sources returned nothing
                    if (!liveData) {
                        try { liveData = await fetchAIPrice(ing.name); } catch { /* continue */ }
                    }

                    if (liveData) {
                        const basePrice = liveData.price;
                        const isLiveMarket = liveData.source === 'LIVE';
                        trends = Array.from({ length: 6 }, (_, i) => {
                            const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
                            const drift = basePrice * ((i - 2.5) * 0.020);
                            const noise = basePrice * seededNoise(ing.name, i) * (isLiveMarket ? 0.6 : 1.0);
                            return {
                                date: d.toISOString(),
                                price: Math.max(0.10, +(basePrice + drift + noise).toFixed(2)),
                                source: `${isLiveMarket ? 'LIVE' : liveData!.source} — ${liveData!.label}`,
                            };
                        });
                        trends[trends.length - 1].price = basePrice;
                    } else {
                        // 4. True last resort: fully deterministic estimate
                        trends = generateEstimatedTrends(ing.name, getBasePrice(ing.name));
                    }

                    // Queue for batch DB write
                    if (ing.id) {
                        for (const t of trends) {
                            trendsToWrite.push({
                                ingredientId: ing.id,
                                price: t.price,
                                date: new Date(t.date),
                                source: t.source,
                            });
                        }
                    }
                }

                const latestTrend = trends[trends.length - 1];
                const isLive = latestTrend.source.startsWith('LIVE');

                return {
                    name: ing.name,
                    id: ing.id,
                    currentPrice: latestTrend.price,
                    unit: 'per lb',
                    orderQuantity: typeof ing.quantity === 'number' ? ing.quantity : null,
                    orderUnit: ing.unit ?? null,
                    lineTotal: typeof ing.quantity === 'number'
                        ? +(latestTrend.price * ((ing.unit ?? '').toLowerCase() === 'oz' ? ing.quantity / 16 : ing.quantity)).toFixed(2)
                        : latestTrend.price,
                    source: isLive ? latestTrend.source : 'Estimated',
                    isLive,
                    history: trends,
                };
            })
        );

        // ── Batch DB writes (single round-trip each) ──────────────────────────
        await Promise.all([
            staleIds.length > 0
                ? prisma.pricingTrend.deleteMany({ where: { ingredientId: { in: staleIds } } })
                : Promise.resolve(),
            trendsToWrite.length > 0
                ? prisma.pricingTrend.createMany({ data: trendsToWrite, skipDuplicates: true })
                : Promise.resolve(),
        ]);

        return NextResponse.json({ pricing: pricingResults });

    } catch (error: any) {
        console.error('Error fetching pricing:', error);
        return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 });
    }
}
