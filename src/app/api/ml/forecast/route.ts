import { NextResponse } from 'next/server';

// ─── Linear Regression ────────────────────────────────────────────────────────
// Ordinary Least Squares on a 1-D index (t = 0,1,2,...) vs price
function linearRegression(prices: number[]) {
    const n = prices.length;
    if (n < 2) return { slope: 0, intercept: prices[0] ?? 0, r2: 0, se: 0 };

    const xMean = (n - 1) / 2;
    const yMean = prices.reduce((a, b) => a + b, 0) / n;

    let ssXY = 0, ssXX = 0;
    for (let i = 0; i < n; i++) {
        ssXY += (i - xMean) * (prices[i] - yMean);
        ssXX += (i - xMean) ** 2;
    }

    const slope = ssXX !== 0 ? ssXY / ssXX : 0;
    const intercept = yMean - slope * xMean;

    // Residuals for R² and standard error
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
        const predicted = slope * i + intercept;
        ssTot += (prices[i] - yMean) ** 2;
        ssRes += (prices[i] - predicted) ** 2;
    }

    const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
    const se = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

    return { slope, intercept, r2, se };
}

// ─── Z-score anomaly detection ────────────────────────────────────────────────
function detectAnomaly(prices: number[]) {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const std = Math.sqrt(prices.reduce((acc, p) => acc + (p - mean) ** 2, 0) / prices.length);
    const current = prices[prices.length - 1];
    const zscore = std > 0 ? (current - mean) / std : 0;

    return {
        mean: +mean.toFixed(2),
        std: +std.toFixed(2),
        zscore: +zscore.toFixed(2),
        isAnomaly: Math.abs(zscore) > 1.4,
        type: zscore > 1.4 ? 'SPIKE' : zscore < -1.4 ? 'DIP' : 'NORMAL',
        deviationPct: +((Math.abs(current - mean) / mean) * 100).toFixed(1),
    };
}

// ─── Buy/Wait recommendation ──────────────────────────────────────────────────
function getBuySignal(trend: string, anomaly: ReturnType<typeof detectAnomaly>) {
    if (anomaly.type === 'DIP') return { signal: 'BUY_NOW', reason: 'Price below historical average — ideal procurement window' };
    if (anomaly.type === 'SPIKE' && trend === 'RISING') return { signal: 'WAIT', reason: 'Active price spike — wait for correction before ordering' };
    if (trend === 'FALLING') return { signal: 'WAIT', reason: 'Downward trend — prices likely to improve in 30–60 days' };
    if (trend === 'RISING') return { signal: 'BUY_NOW', reason: 'Rising trend detected — lock in current pricing' };
    return { signal: 'NEUTRAL', reason: 'Stable market — no urgency' };
}

// POST /api/ml/forecast
// Body: { ingredients: [{ name, history: [{date, price}], currentPrice }] }
export async function POST(req: Request) {
    try {
        const { ingredients } = await req.json();
        if (!ingredients || !Array.isArray(ingredients)) {
            return NextResponse.json({ error: 'ingredients array required' }, { status: 400 });
        }

        const forecasts = ingredients.map((ing: any) => {
            const prices: number[] = (ing.history ?? [])
                .map((h: any) => h.price)
                .filter((p: number) => typeof p === 'number' && p > 0);

            if (prices.length < 3) {
                return {
                    name: ing.name,
                    forecast: [],
                    trend: 'STABLE',
                    trendPct: 0,
                    anomaly: null,
                    r2: 0,
                    confidence: 'LOW',
                    buySignal: { signal: 'NEUTRAL', reason: 'Insufficient price history' },
                };
            }

            const { slope, intercept, r2, se } = linearRegression(prices);

            // 3-month forward projection with 95% CI (t=1.96 for large n)
            const lastIdx = prices.length - 1;
            const lastDate = ing.history[ing.history.length - 1]?.date
                ? new Date(ing.history[ing.history.length - 1].date)
                : new Date();

            const forecast = [1, 2, 3].map(offset => {
                const idx = lastIdx + offset;
                const predicted = Math.max(0.01, slope * idx + intercept);
                const ci = 1.96 * se;
                const fDate = new Date(lastDate.getFullYear(), lastDate.getMonth() + offset, 1);
                return {
                    date: fDate.toISOString(),
                    price: +predicted.toFixed(2),
                    low: +Math.max(0.01, predicted - ci).toFixed(2),
                    high: +(predicted + ci).toFixed(2),
                };
            });

            // Trend: classify by % change per month relative to mean price
            const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
            const monthlyChangePct = meanPrice > 0 ? (slope / meanPrice) * 100 : 0;
            const trend = monthlyChangePct > 2.5 ? 'RISING' : monthlyChangePct < -2.5 ? 'FALLING' : 'STABLE';
            const trendPct = +Math.abs(monthlyChangePct * 3).toFixed(1); // 3-month projection

            const anomaly = detectAnomaly(prices);
            const confidence = r2 > 0.78 ? 'HIGH' : r2 > 0.45 ? 'MEDIUM' : 'LOW';
            const buySignal = getBuySignal(trend, anomaly);

            return {
                name: ing.name,
                forecast,
                trend,
                trendPct,
                anomaly: anomaly.isAnomaly ? anomaly : null,
                r2: +r2.toFixed(3),
                confidence,
                buySignal,
                regression: { slope: +slope.toFixed(4), intercept: +intercept.toFixed(2) },
            };
        });

        return NextResponse.json({ forecasts });
    } catch (error: any) {
        console.error('ML forecast error:', error);
        return NextResponse.json({ error: error.message || 'Forecast failed' }, { status: 500 });
    }
}
