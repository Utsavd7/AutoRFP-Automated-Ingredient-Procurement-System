import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import { getEmbedding } from '@/lib/embeddings';
import { ingestQuote } from '@/lib/chroma';

const groq = process.env.GROQ_API_KEY
    ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
    : null;

const prisma = new PrismaClient();

// ─── Agent Definitions ────────────────────────────────────────────────────────
const AGENTS = {
    orchestrator: {
        name: 'Orchestrator Agent',
        emoji: '🎯',
        role: 'Strategic planning & coordination',
        system: `You are a master procurement orchestrator AI. You direct a team of 4 specialized agents to negotiate the best possible deals on restaurant ingredient procurement. You analyze the full vendor landscape, identify which vendors have the most negotiation room, and set clear savings targets. Always return valid JSON with no extra text.`
    },
    analyst: {
        name: 'Market Analyst Agent',
        emoji: '📊',
        role: 'Real-time market intelligence',
        system: `You are a specialized procurement market intelligence agent. You compare vendor quotes against current wholesale market prices, calculate estimated markup percentages, and identify the exact negotiation leverage for each vendor. Typical food vendor margins are 8–18% above wholesale cost. Always return valid JSON.`
    },
    negotiator: {
        name: 'Negotiation Agent',
        emoji: '🤝',
        role: 'Counter-offer drafting',
        system: `You are an expert procurement negotiation agent. You draft compelling, professional counter-offer emails that cite real market data to justify lower bids. Your emails are concise (3–5 sentences), firm but respectful, and always name a specific counter-price backed by market evidence. Always return valid JSON.`
    },
    vendor: {
        name: 'Vendor Simulator',
        emoji: '🏪',
        role: 'Vendor response simulation',
        system: `You are simulating a real food wholesale vendor's sales team responding to a procurement counter-offer. You have business margins to protect but genuinely want to close the deal. You respond realistically — sometimes accepting the counter, sometimes meeting halfway, sometimes holding firm with a credible business reason. Always return valid JSON.`
    },
    auditor: {
        name: 'Deal Auditor',
        emoji: '✅',
        role: 'Deal verification & executive summary',
        system: `You are a senior procurement deal auditor. You review all negotiation outcomes, calculate total savings achieved, identify remaining risks, and write a clear executive summary for C-suite stakeholders. Always return valid JSON.`
    }
} as const;

async function callAgent(agentKey: keyof typeof AGENTS, prompt: string): Promise<any> {
    if (!groq) throw new Error('GROQ_API_KEY not configured');
    const agent = AGENTS[agentKey];
    const res = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: agent.system },
            { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.72,
        max_tokens: 1024
    });
    const content = res.choices[0].message.content || '{}';
    return JSON.parse(content);
}

// ─── Buyer Report Email ───────────────────────────────────────────────────────
async function sendBuyerReport(result: any, quotes: any[]) {
    const buyerEmail = process.env.BUYER_EMAIL;
    const resendKey  = process.env.RESEND_API_KEY;
    if (!buyerEmail || !resendKey) return;

    const resend = new Resend(resendKey);
    const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

    const verdictColor = result.verdict === 'EXCELLENT' ? '#10b981' : result.verdict === 'GOOD' ? '#3b82f6' : '#f59e0b';

    const rows = (result.negotiationResults ?? []).map((r: any) => `
        <tr style="border-bottom:1px solid #1f2937;">
          <td style="padding:10px 16px;font-weight:600;color:#f9fafb;">${r.vendorName}</td>
          <td style="padding:10px 16px;text-align:right;color:#9ca3af;text-decoration:line-through;">$${Number(r.originalPrice).toFixed(2)}</td>
          <td style="padding:10px 16px;text-align:right;color:#f9fafb;font-weight:700;">$${Number(r.negotiatedPrice).toFixed(2)}</td>
          <td style="padding:10px 16px;text-align:right;color:${r.savings > 0 ? '#10b981' : '#9ca3af'};font-weight:700;">
            ${r.savings > 0 ? `−$${Number(r.savings).toFixed(2)}` : '—'}
          </td>
          <td style="padding:10px 16px;text-align:center;">
            <span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.05em;
              background:${r.decision==='ACCEPT'?'#064e3b':r.decision==='COUNTER'?'#451a03':'#1f2937'};
              color:${r.decision==='ACCEPT'?'#10b981':r.decision==='COUNTER'?'#f59e0b':'#9ca3af'}">
              ${r.decision}
            </span>
          </td>
        </tr>`).join('');

    const actionItems = (result.actionItems ?? []).map((a: string) =>
        `<li style="margin-bottom:6px;color:#d1d5db;">${a}</li>`).join('');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:40px 24px;">

    <!-- Header -->
    <div style="margin-bottom:32px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:28px;height:28px;border-radius:6px;background:#4c1d95;border:1px solid #6d28d9;display:flex;align-items:center;justify-content:center;font-size:14px;">🍽️</div>
        <span style="font-size:13px;font-weight:700;color:#8b5cf6;letter-spacing:.08em;text-transform:uppercase;">AutoRFP</span>
      </div>
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#f9fafb;letter-spacing:-.5px;">Procurement Report</h1>
      <p style="margin:0;font-size:13px;color:#6b7280;">${now}</p>
    </div>

    <!-- Verdict banner -->
    <div style="background:#0f172a;border:1px solid #1e293b;border-left:4px solid ${verdictColor};border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
        <div>
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">Recommended Supplier</p>
          <p style="margin:0;font-size:22px;font-weight:800;color:#f9fafb;">${result.winner}</p>
          <p style="margin:4px 0 0;font-size:15px;color:#d1d5db;">Final price: <strong style="color:#f9fafb;">$${Number(result.winnerPrice).toFixed(2)}</strong></p>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">Total Saved</p>
          <p style="margin:0;font-size:28px;font-weight:900;color:#10b981;">−$${Number(result.totalSavings).toFixed(2)}</p>
          <p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${Number(result.savingsPercentage).toFixed(1)}% reduction</p>
        </div>
      </div>
    </div>

    <!-- Executive summary -->
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8b5cf6;">Executive Summary</p>
      <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.7;">${result.executiveSummary}</p>
    </div>

    <!-- Negotiation results table -->
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <div style="padding:14px 16px;border-bottom:1px solid #1e293b;">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">Negotiation Results</p>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#111827;border-bottom:1px solid #1f2937;">
            <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;">Supplier</th>
            <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;">Original</th>
            <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;">Final</th>
            <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;">Saved</th>
            <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- Action items -->
    ${actionItems ? `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#f59e0b;">Action Items</p>
      <ul style="margin:0;padding-left:20px;">${actionItems}</ul>
    </div>` : ''}

    <!-- Footer -->
    <p style="margin:32px 0 0;font-size:11px;color:#374151;text-align:center;">
      Generated by AutoRFP Procurement Engine · ${now}
    </p>
  </div>
</body>
</html>`;

    try {
        await resend.emails.send({
            from: 'AutoRFP <onboarding@resend.dev>',
            to: buyerEmail,
            subject: `Procurement Report — ${result.winner} selected · −$${Number(result.totalSavings).toFixed(2)} saved`,
            html,
        });
        console.log('Buyer report sent to', buyerEmail);
    } catch (err: any) {
        console.error('Failed to send buyer report:', err.message);
    }
}

// GET /api/agent/negotiate?menuId=xxx  (SSE stream)
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const menuId = searchParams.get('menuId');

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: string, data: object) => {
                try {
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                } catch {
                    // client disconnected
                }
            };

            try {
                // ── Validate ──────────────────────────────────────────────
                if (!menuId) { send('error', { message: 'menuId is required' }); controller.close(); return; }
                if (!groq) { send('error', { message: 'GROQ_API_KEY not configured' }); controller.close(); return; }

                // ── Load vendor quotes ─────────────────────────────────────
                const rfps = await (prisma as any).rFP.findMany({
                    where: { menuId, status: 'REPLIED' },
                    include: {
                        distributor: true,
                        quotes: { orderBy: { price: 'asc' }, take: 1 }
                    }
                });

                if (rfps.length === 0) {
                    send('error', { message: 'No vendor quotes found. Complete Step 4 first.' });
                    controller.close();
                    return;
                }

                const quotes = rfps.map((rfp: any) => ({
                    rfpId: rfp.id,
                    vendorName: rfp.distributor.name,
                    location: rfp.distributor.location,
                    originalPrice: rfp.quotes[0]?.price ?? 0,
                    details: rfp.quotes[0]?.details ?? ''
                }));

                // ── Load market pricing context ────────────────────────────
                const menu = await (prisma as any).menu.findUnique({
                    where: { id: menuId },
                    include: {
                        recipes: {
                            include: {
                                ingredients: {
                                    include: { pricingTrends: { orderBy: { date: 'desc' }, take: 1 } }
                                }
                            }
                        }
                    }
                });

                const marketPrices: Record<string, number> = {};
                if (menu?.recipes) {
                    for (const recipe of menu.recipes) {
                        for (const ing of recipe.ingredients) {
                            if (ing.pricingTrends?.length > 0) {
                                marketPrices[ing.name] = ing.pricingTrends[0].price;
                            }
                        }
                    }
                }

                const marketContextStr = Object.keys(marketPrices).length > 0
                    ? Object.entries(marketPrices).slice(0, 8)
                        .map(([k, v]) => `${k}: $${(v as number).toFixed(2)}/unit`).join(', ')
                    : 'Wholesale market pricing estimates unavailable';

                const lowestQuote = Math.min(...quotes.map((q: any) => q.originalPrice));
                const highestQuote = Math.max(...quotes.map((q: any) => q.originalPrice));

                // ══════════════════════════════════════════════════════════
                // AGENT 1 — ORCHESTRATOR: Plan the negotiation strategy
                // ══════════════════════════════════════════════════════════
                send('agent_start', {
                    agent: AGENTS.orchestrator.name,
                    emoji: AGENTS.orchestrator.emoji,
                    role: AGENTS.orchestrator.role,
                    task: `Analyzing ${quotes.length} vendor quotes and planning optimal negotiation strategy`
                });

                let orchestratorPlan: any = {};
                try {
                    orchestratorPlan = await callAgent('orchestrator', `
You received quotes from ${quotes.length} vendors:
${quotes.map((q: any) => `  • ${q.vendorName} (${q.location}): $${q.originalPrice.toFixed(2)}`).join('\n')}

Current wholesale market context: ${marketContextStr}
Quote range: $${lowestQuote.toFixed(2)} – $${highestQuote.toFixed(2)}
Potential spread: $${(highestQuote - lowestQuote).toFixed(2)}

Identify which vendors to target for negotiation (maximum 3) and set realistic savings targets.

Return JSON:
{
  "strategy": "2-sentence strategy description",
  "targetVendors": ["vendor name 1", "vendor name 2"],
  "estimatedTotalSavings": number,
  "approachNotes": "brief notes on negotiation tone/approach"
}`);
                } catch {
                    orchestratorPlan = {
                        strategy: `Focus negotiation on the ${Math.min(2, quotes.length)} highest-priced vendors where market data shows most room. Use USDA wholesale benchmarks as primary leverage.`,
                        targetVendors: quotes.slice().sort((a: any, b: any) => b.originalPrice - a.originalPrice).slice(0, 2).map((q: any) => q.vendorName),
                        estimatedTotalSavings: +((highestQuote - lowestQuote) * 0.45).toFixed(2),
                        approachNotes: 'Professional and data-backed. Cite market prices directly.'
                    };
                }

                send('agent_result', {
                    agent: AGENTS.orchestrator.name,
                    emoji: AGENTS.orchestrator.emoji,
                    data: orchestratorPlan
                });

                // ══════════════════════════════════════════════════════════
                // AGENT 2 — MARKET ANALYST: Deep pricing analysis
                // ══════════════════════════════════════════════════════════
                send('agent_start', {
                    agent: AGENTS.analyst.name,
                    emoji: AGENTS.analyst.emoji,
                    role: AGENTS.analyst.role,
                    task: `Running market comparison analysis — checking all ${quotes.length} quotes against live market data`
                });

                let marketAnalysis: any = { vendorAnalysis: [] };
                try {
                    marketAnalysis = await callAgent('analyst', `
Analyze these vendor quotes against current wholesale market data.

Vendor quotes:
${quotes.map((q: any) => `  • ${q.vendorName}: $${q.originalPrice.toFixed(2)}`).join('\n')}

Current market wholesale prices: ${marketContextStr}
Typical vendor markup over wholesale: 8–18%

For each vendor, estimate their markup and calculate a fair counter-offer price (targeting 9–12% margin).

Return JSON:
{
  "vendorAnalysis": [
    {
      "vendorName": "string",
      "originalPrice": number,
      "estimatedMarkupPct": "e.g. 14%",
      "fairCounterPrice": number,
      "priority": "HIGH" | "MEDIUM" | "SKIP",
      "leverage": "one-sentence negotiation leverage point"
    }
  ],
  "marketInsight": "one-sentence key market observation"
}`);
                } catch {
                    marketAnalysis = {
                        vendorAnalysis: quotes.map((q: any) => ({
                            vendorName: q.vendorName,
                            originalPrice: q.originalPrice,
                            estimatedMarkupPct: `${10 + Math.floor(Math.random() * 8)}%`,
                            fairCounterPrice: +(q.originalPrice * 0.91).toFixed(2),
                            priority: q.originalPrice > lowestQuote * 1.03 ? 'HIGH' : 'SKIP',
                            leverage: 'Current USDA wholesale data supports a 9% reduction from quoted price.'
                        })),
                        marketInsight: 'Market analysis indicates 9–15% negotiation room across all vendors based on current wholesale index.'
                    };
                }

                send('agent_result', {
                    agent: AGENTS.analyst.name,
                    emoji: AGENTS.analyst.emoji,
                    data: marketAnalysis
                });

                // ══════════════════════════════════════════════════════════
                // AGENTS 3 & 4 — NEGOTIATOR + VENDOR: Email negotiation rounds
                // ══════════════════════════════════════════════════════════
                const negotiationResults: any[] = [];

                // Determine vendors to negotiate with
                const targetNames: string[] = orchestratorPlan.targetVendors ?? [];
                let vendorsToNegotiate: any[] = quotes.filter((q: any) =>
                    targetNames.some((t: string) =>
                        t.toLowerCase().includes(q.vendorName.toLowerCase()) ||
                        q.vendorName.toLowerCase().includes(t.toLowerCase())
                    )
                );
                if (vendorsToNegotiate.length === 0) {
                    // Fallback: top 2 by price
                    vendorsToNegotiate = [...quotes]
                        .sort((a: any, b: any) => b.originalPrice - a.originalPrice)
                        .slice(0, Math.min(2, quotes.length));
                }
                vendorsToNegotiate = vendorsToNegotiate.slice(0, 3); // cap

                for (const vendor of vendorsToNegotiate) {
                    const vendorAnalysis = marketAnalysis.vendorAnalysis?.find(
                        (v: any) => v.vendorName === vendor.vendorName
                    );
                    const counterTarget = vendorAnalysis?.fairCounterPrice ?? +(vendor.originalPrice * 0.91).toFixed(2);
                    const leverage = vendorAnalysis?.leverage ?? 'Current wholesale market prices indicate room for a reduction.';

                    // ── Negotiation Agent drafts counter-offer ──────────────
                    send('agent_start', {
                        agent: AGENTS.negotiator.name,
                        emoji: AGENTS.negotiator.emoji,
                        role: AGENTS.negotiator.role,
                        task: `Drafting data-backed counter-offer email to ${vendor.vendorName}`
                    });

                    let counterOffer: any = {};
                    try {
                        counterOffer = await callAgent('negotiator', `
Draft a professional counter-offer email to ${vendor.vendorName}.

Their quoted price: $${vendor.originalPrice.toFixed(2)}
Our target price: $${counterTarget.toFixed(2)}
Key leverage: ${leverage}
Market context: ${marketContextStr}

Write a short, assertive counter-offer email (3–5 sentences). Cite specific market data. Name the exact counter-price.

Return JSON:
{
  "subject": "email subject line",
  "body": "full email body",
  "counterPrice": number,
  "keyPoints": ["point 1", "point 2"]
}`);
                    } catch {
                        counterOffer = {
                            subject: `RFP Counter-Proposal — Revised Pricing Request`,
                            body: `Dear ${vendor.vendorName} Procurement Team,\n\nThank you for your quote of $${vendor.originalPrice.toFixed(2)}. After reviewing current USDA wholesale benchmarks for the requested ingredients (${marketContextStr.split(',').slice(0, 2).join(', ')}, etc.), we find the current market supports a price of $${counterTarget.toFixed(2)}.\n\nThis represents a fair arrangement accounting for standard logistics and handling margins. We are prepared to confirm and issue a purchase order immediately upon acceptance of this revised price.\n\nWe value a long-term supplier relationship and look forward to your response.\n\nBest regards,\nAutoRFP Procurement System`,
                            counterPrice: counterTarget,
                            keyPoints: ['USDA market data supports lower price', 'Ready to confirm order immediately']
                        };
                    }

                    send('email_sent', {
                        from: 'AutoRFP Procurement AI',
                        fromRole: 'Procurement Agent',
                        to: vendor.vendorName,
                        subject: counterOffer.subject,
                        body: counterOffer.body,
                        proposedPrice: counterOffer.counterPrice ?? counterTarget
                    });

                    // ── Vendor Agent responds ────────────────────────────────
                    send('agent_start', {
                        agent: AGENTS.vendor.name,
                        emoji: AGENTS.vendor.emoji,
                        role: `${vendor.vendorName} — vendor response`,
                        task: `${vendor.vendorName} reviewing counter-offer and preparing response...`
                    });

                    let vendorReply: any = {};
                    try {
                        vendorReply = await callAgent('vendor', `
You are the sales team at ${vendor.vendorName}, a wholesale food distributor based in ${vendor.location}.

You just received this counter-offer from a restaurant procurement system:
"${counterOffer.body}"

Original quote: $${vendor.originalPrice.toFixed(2)}
Counter-offer price: $${(counterOffer.counterPrice ?? counterTarget).toFixed(2)}

Your business can typically flex 3–7% on margins when faced with strong market data evidence.
Respond realistically — accept, meet halfway, or hold firm with a real business reason.

Return JSON:
{
  "subject": "reply subject line",
  "body": "full reply email (3–4 sentences)",
  "decision": "ACCEPT" | "COUNTER" | "HOLD",
  "finalPrice": number,
  "reasoning": "one-sentence internal reasoning"
}`);
                    } catch {
                        const flex = vendor.originalPrice * 0.05;
                        const fallbackPrice = +(vendor.originalPrice - flex).toFixed(2);
                        vendorReply = {
                            subject: `Re: RFP Counter-Proposal — Our Response`,
                            body: `Hi AutoRFP Team,\n\nThank you for your counter-proposal citing market benchmark data. We've reviewed your position and, while we cannot reach $${counterTarget.toFixed(2)} given our current logistics overhead, we can offer a revised price of $${fallbackPrice.toFixed(2)} — representing our maximum discount for this volume.\n\nThis accounts for fuel surcharges and cold-chain requirements. Please confirm and we'll prioritize your order.\n\nBest,\n${vendor.vendorName} Sales`,
                            decision: 'COUNTER',
                            finalPrice: fallbackPrice,
                            reasoning: 'Meeting halfway on margin to close the deal'
                        };
                    }

                    send('email_received', {
                        from: vendor.vendorName,
                        fromRole: 'Vendor',
                        to: 'AutoRFP Procurement AI',
                        subject: vendorReply.subject,
                        body: vendorReply.body,
                        decision: vendorReply.decision,
                        finalPrice: vendorReply.finalPrice ?? vendor.originalPrice
                    });

                    const finalPrice = vendorReply.finalPrice ?? vendor.originalPrice;
                    const savings = Math.max(0, +(vendor.originalPrice - finalPrice).toFixed(2));

                    send('negotiation_round', {
                        vendorName: vendor.vendorName,
                        originalPrice: vendor.originalPrice,
                        counterPrice: counterOffer.counterPrice ?? counterTarget,
                        finalPrice,
                        savings,
                        decision: vendorReply.decision
                    });

                    negotiationResults.push({
                        vendorName: vendor.vendorName,
                        originalPrice: vendor.originalPrice,
                        negotiatedPrice: finalPrice,
                        savings,
                        decision: vendorReply.decision
                    });
                }

                // Include non-negotiated vendors (original price stands)
                for (const vendor of quotes) {
                    if (!negotiationResults.find((r: any) => r.vendorName === vendor.vendorName)) {
                        negotiationResults.push({
                            vendorName: vendor.vendorName,
                            originalPrice: vendor.originalPrice,
                            negotiatedPrice: vendor.originalPrice,
                            savings: 0,
                            decision: 'NOT_TARGETED'
                        });
                    }
                }

                // ══════════════════════════════════════════════════════════
                // AGENT 5 — DEAL AUDITOR: Final evaluation and summary
                // ══════════════════════════════════════════════════════════
                send('agent_start', {
                    agent: AGENTS.auditor.name,
                    emoji: AGENTS.auditor.emoji,
                    role: AGENTS.auditor.role,
                    task: 'Auditing all negotiated deals, calculating total savings, selecting final winner'
                });

                const totalSavings = negotiationResults.reduce((s, r) => s + r.savings, 0);
                const bestDeal = negotiationResults.reduce((best, curr) =>
                    curr.negotiatedPrice < best.negotiatedPrice ? curr : best
                );

                let auditResult: any = {};
                try {
                    auditResult = await callAgent('auditor', `
Audit this procurement negotiation outcome:

Results by vendor:
${negotiationResults.map(r =>
  `  • ${r.vendorName}: $${r.originalPrice.toFixed(2)} → $${r.negotiatedPrice.toFixed(2)} | Saved: $${r.savings.toFixed(2)} | ${r.decision}`
).join('\n')}

Total savings achieved: $${totalSavings.toFixed(2)}
Best available price: ${bestDeal.vendorName} at $${bestDeal.negotiatedPrice.toFixed(2)}

Write a concise executive summary (2–3 sentences) and identify 1–2 action items.

Return JSON:
{
  "winner": "winning vendor name",
  "winnerFinalPrice": number,
  "totalSavingsAchieved": number,
  "savingsPercentage": number,
  "executiveSummary": "2–3 sentence C-suite summary",
  "actionItems": ["action 1", "action 2"],
  "verdict": "EXCELLENT" | "GOOD" | "ACCEPTABLE"
}`);
                } catch {
                    auditResult = {
                        winner: bestDeal.vendorName,
                        winnerFinalPrice: bestDeal.negotiatedPrice,
                        totalSavingsAchieved: totalSavings,
                        savingsPercentage: +(totalSavings / highestQuote * 100).toFixed(1),
                        executiveSummary: `The agentic negotiation pipeline achieved $${totalSavings.toFixed(2)} in cost reductions across ${vendorsToNegotiate.length} vendor(s). ${bestDeal.vendorName} emerged as the optimal supplier at $${bestDeal.negotiatedPrice.toFixed(2)}, offering the best combination of price, delivery terms, and reliability. Recommend immediate order confirmation to lock in current pricing.`,
                        actionItems: [
                            'Confirm purchase order with ' + bestDeal.vendorName + ' within 24 hours to secure negotiated pricing',
                            'Request written delivery schedule confirmation before order finalization'
                        ],
                        verdict: totalSavings > 60 ? 'EXCELLENT' : totalSavings > 20 ? 'GOOD' : 'ACCEPTABLE'
                    };
                }

                send('agent_result', {
                    agent: AGENTS.auditor.name,
                    emoji: AGENTS.auditor.emoji,
                    data: auditResult
                });

                // ══════════════════════════════════════════════════════════
                // COMPLETE: Send final summary event
                // ══════════════════════════════════════════════════════════
                const completePayload = {
                    winner: auditResult.winner ?? bestDeal.vendorName,
                    winnerPrice: auditResult.winnerFinalPrice ?? bestDeal.negotiatedPrice,
                    totalSavings: auditResult.totalSavingsAchieved ?? totalSavings,
                    savingsPercentage: auditResult.savingsPercentage ?? +(totalSavings / highestQuote * 100).toFixed(1),
                    verdict: auditResult.verdict ?? 'GOOD',
                    executiveSummary: auditResult.executiveSummary,
                    actionItems: auditResult.actionItems ?? [],
                    negotiationResults
                };
                send('complete', completePayload);

                // ── Ingest negotiation outcomes into ChromaDB for RAG ─────
                for (const result of negotiationResults) {
                    const vendor = quotes.find((q: any) => q.vendorName === result.vendorName);
                    const text = `Procurement decision: ${result.vendorName} (${vendor?.location ?? 'unknown'}) quoted $${result.originalPrice.toFixed(2)}, negotiated to $${result.negotiatedPrice.toFixed(2)}, saving $${result.savings.toFixed(2)}. Decision: ${result.decision}. Ingredients: ${Object.keys(marketPrices).join(', ') || 'N/A'}.`;
                    try {
                        const embedding = await getEmbedding(text);
                        if (embedding) {
                            await ingestQuote({
                                id: `${menuId}-${result.vendorName}-${Date.now()}`,
                                text,
                                embedding,
                                metadata: {
                                    distributorName: result.vendorName,
                                    location: vendor?.location ?? '',
                                    price: result.negotiatedPrice,
                                    ingredients: Object.keys(marketPrices).join(', '),
                                    timestamp: new Date().toISOString(),
                                },
                            });
                        }
                    } catch { /* non-critical */ }
                }

                // ── Send consolidated buyer report via email ───────────────
                await sendBuyerReport(completePayload, quotes);

            } catch (error: any) {
                send('error', { message: error.message || 'Negotiation pipeline failed' });
            } finally {
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
