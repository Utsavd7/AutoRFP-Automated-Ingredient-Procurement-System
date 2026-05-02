import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { Resend } from 'resend';
import { getEmbedding } from '@/lib/embeddings';
import { ingestQuote } from '@/lib/chroma';
import { prisma } from '@/lib/prisma';
import { callGroqThenOllama, parseJSON as parseLLMJSON } from '@/lib/llm';

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuoteItem {
    rfpId: string;
    vendorName: string;
    location: string;
    originalPrice: number;
    details: string;
}

interface NegotiationResult {
    vendorName: string;
    originalPrice: number;
    negotiatedPrice: number;
    savings: number;
    decision: string;
}

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
    },
} as const;

async function callAgent(agentKey: keyof typeof AGENTS, prompt: string): Promise<Record<string, unknown>> {
    const agent = AGENTS[agentKey];
    const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: agent.system },
        { role: 'user', content: prompt },
    ];
    const text = await callGroqThenOllama(messages, true);
    const parsed = parseLLMJSON<Record<string, unknown>>(text);
    if (parsed && Object.keys(parsed).length > 0) return parsed;
    return JSON.parse(text || '{}');
}

// ─── Request-scoped SSE Senders ───────────────────────────────────────────────
// Stream controllers are not serialisable — they live outside graph state,
// keyed by requestId which flows through the typed graph state.

const _senders = new Map<string, (event: string, data: object) => void>();

function getSend(requestId: string): (event: string, data: object) => void {
    return _senders.get(requestId) ?? (() => {});
}

// ─── LangGraph State ──────────────────────────────────────────────────────────

const NegotiationState = Annotation.Root({
    requestId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
    menuId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
    tenantId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
    quotes: Annotation<QuoteItem[]>({ reducer: (_, b) => b, default: () => [] }),
    marketPrices: Annotation<Record<string, number>>({ reducer: (_, b) => b, default: () => ({}) }),
    marketContextStr: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
    lowestQuote: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
    highestQuote: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
    orchestratorPlan: Annotation<Record<string, any>>({ reducer: (_, b) => b, default: () => ({}) }),
    marketAnalysis: Annotation<Record<string, any>>({ reducer: (_, b) => b, default: () => ({ vendorAnalysis: [] }) }),
    // accumulates as each vendor round completes
    negotiationResults: Annotation<NegotiationResult[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
    auditResult: Annotation<Record<string, any>>({ reducer: (_, b) => b, default: () => ({}) }),
    completePayload: Annotation<Record<string, any> | null>({ reducer: (_, b) => b, default: () => null }),
});

type NegotiationStateType = typeof NegotiationState.State;

// ─── Node: Load Data ──────────────────────────────────────────────────────────

async function loadDataNode(state: NegotiationStateType): Promise<Partial<NegotiationStateType>> {
    const { menuId } = state;

    const rfps = await (prisma as any).rFP.findMany({
        where: { menuId, status: 'REPLIED' },
        include: {
            distributor: true,
            quotes: { orderBy: { price: 'asc' }, take: 1 },
        },
    });

    if (rfps.length === 0) throw new Error('No vendor quotes found. Complete Step 4 first.');

    await prisma.menu.update({
        where: { id: menuId },
        data: { workflowStatus: 'NEGOTIATING', lastActivityAt: new Date() },
    });

    await prisma.rFP.updateMany({
        where: { menuId, status: 'REPLIED' },
        data: { status: 'NEGOTIATING', negotiatedAt: new Date() },
    });

    const quotes: QuoteItem[] = rfps.map((rfp: any) => ({
        rfpId: rfp.id,
        vendorName: rfp.distributor.name,
        location: rfp.distributor.location,
        originalPrice: rfp.quotes[0]?.price ?? 0,
        details: rfp.quotes[0]?.details ?? '',
    }));

    const menu = await (prisma as any).menu.findUnique({
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
        ? Object.entries(marketPrices).slice(0, 8).map(([k, v]) => `${k}: $${(v as number).toFixed(2)}/unit`).join(', ')
        : 'Wholesale market pricing estimates unavailable';

    const prices = quotes.map(q => q.originalPrice);
    return {
        quotes,
        marketPrices,
        marketContextStr,
        lowestQuote: Math.min(...prices),
        highestQuote: Math.max(...prices),
    };
}

// ─── Node: Orchestrate ────────────────────────────────────────────────────────

async function orchestrateNode(state: NegotiationStateType): Promise<Partial<NegotiationStateType>> {
    const { requestId, quotes, marketContextStr, lowestQuote, highestQuote } = state;
    const send = getSend(requestId);

    send('agent_start', {
        agent: AGENTS.orchestrator.name,
        emoji: AGENTS.orchestrator.emoji,
        role: AGENTS.orchestrator.role,
        task: `Analyzing ${quotes.length} vendor quotes and planning optimal negotiation strategy`,
    });

    let orchestratorPlan: Record<string, any>;
    try {
        orchestratorPlan = await callAgent('orchestrator', `
You received quotes from ${quotes.length} vendors:
${quotes.map(q => `  • ${q.vendorName} (${q.location}): $${q.originalPrice.toFixed(2)}`).join('\n')}

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
            targetVendors: quotes.slice().sort((a, b) => b.originalPrice - a.originalPrice).slice(0, 2).map(q => q.vendorName),
            estimatedTotalSavings: +((highestQuote - lowestQuote) * 0.45).toFixed(2),
            approachNotes: 'Professional and data-backed. Cite market prices directly.',
        };
    }

    send('agent_result', { agent: AGENTS.orchestrator.name, emoji: AGENTS.orchestrator.emoji, data: orchestratorPlan });
    return { orchestratorPlan };
}

// ─── Node: Analyze ────────────────────────────────────────────────────────────

async function analyzeNode(state: NegotiationStateType): Promise<Partial<NegotiationStateType>> {
    const { requestId, quotes, marketContextStr, lowestQuote } = state;
    const send = getSend(requestId);

    send('agent_start', {
        agent: AGENTS.analyst.name,
        emoji: AGENTS.analyst.emoji,
        role: AGENTS.analyst.role,
        task: `Running market comparison analysis — checking all ${quotes.length} quotes against live market data`,
    });

    let marketAnalysis: Record<string, any>;
    try {
        marketAnalysis = await callAgent('analyst', `
Analyze these vendor quotes against current wholesale market data.

Vendor quotes:
${quotes.map(q => `  • ${q.vendorName}: $${q.originalPrice.toFixed(2)}`).join('\n')}

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
        const sorted = [...quotes].sort((a, b) => a.originalPrice - b.originalPrice);
        const median = sorted[Math.floor(sorted.length / 2)]?.originalPrice ?? lowestQuote;
        marketAnalysis = {
            vendorAnalysis: quotes.map(q => {
                const aboveMedianRatio = q.originalPrice / (median || q.originalPrice);
                const markupPct = Math.round(8 + Math.min(aboveMedianRatio - 1, 0.10) * 100);
                return {
                    vendorName: q.vendorName,
                    originalPrice: q.originalPrice,
                    estimatedMarkupPct: `${markupPct}%`,
                    fairCounterPrice: +(q.originalPrice * (1 - markupPct / 100 * 0.6)).toFixed(2),
                    priority: q.originalPrice > lowestQuote * 1.03 ? 'HIGH' : 'SKIP',
                    leverage: 'Current USDA wholesale data supports a price reduction from quoted level.',
                };
            }),
            marketInsight: 'Market analysis indicates 9–15% negotiation room across all vendors based on current wholesale index.',
        };
    }

    send('agent_result', { agent: AGENTS.analyst.name, emoji: AGENTS.analyst.emoji, data: marketAnalysis });
    return { marketAnalysis };
}

// ─── Node: Negotiate ──────────────────────────────────────────────────────────

async function negotiateNode(state: NegotiationStateType): Promise<Partial<NegotiationStateType>> {
    const { requestId, quotes, orchestratorPlan, marketAnalysis, marketContextStr } = state;
    const send = getSend(requestId);

    const targetNames: string[] = orchestratorPlan.targetVendors ?? [];
    let vendorsToNegotiate = quotes.filter(q =>
        targetNames.some(t =>
            t.toLowerCase().includes(q.vendorName.toLowerCase()) ||
            q.vendorName.toLowerCase().includes(t.toLowerCase())
        )
    );
    if (vendorsToNegotiate.length === 0) {
        vendorsToNegotiate = [...quotes].sort((a, b) => b.originalPrice - a.originalPrice).slice(0, Math.min(2, quotes.length));
    }
    vendorsToNegotiate = vendorsToNegotiate.slice(0, 3);

    const negotiationResults: NegotiationResult[] = [];

    for (const vendor of vendorsToNegotiate) {
        const vendorAnalysis = (marketAnalysis.vendorAnalysis as any[])?.find(v => v.vendorName === vendor.vendorName);
        const counterTarget: number = vendorAnalysis?.fairCounterPrice ?? +(vendor.originalPrice * 0.91).toFixed(2);
        const leverage: string = vendorAnalysis?.leverage ?? 'Current wholesale market prices indicate room for a reduction.';

        // Draft counter-offer
        send('agent_start', {
            agent: AGENTS.negotiator.name,
            emoji: AGENTS.negotiator.emoji,
            role: AGENTS.negotiator.role,
            task: `Drafting data-backed counter-offer email to ${vendor.vendorName}`,
        });

        let counterOffer: Record<string, any>;
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
                body: `Dear ${vendor.vendorName} Procurement Team,\n\nThank you for your quote of $${vendor.originalPrice.toFixed(2)}. After reviewing current USDA wholesale benchmarks for the requested ingredients (${marketContextStr.split(',').slice(0, 2).join(', ')}, etc.), we find the current market supports a price of $${counterTarget.toFixed(2)}.\n\nThis represents a fair arrangement accounting for standard logistics and handling margins. We are prepared to confirm and issue a purchase order immediately upon acceptance.\n\nBest regards,\nAutoRFP Procurement System`,
                counterPrice: counterTarget,
                keyPoints: ['USDA market data supports lower price', 'Ready to confirm order immediately'],
            };
        }

        send('email_sent', {
            from: 'AutoRFP Procurement AI',
            fromRole: 'Procurement Agent',
            to: vendor.vendorName,
            subject: counterOffer.subject,
            body: counterOffer.body,
            proposedPrice: counterOffer.counterPrice ?? counterTarget,
        });

        // Simulate vendor response
        send('agent_start', {
            agent: AGENTS.vendor.name,
            emoji: AGENTS.vendor.emoji,
            role: `${vendor.vendorName} — vendor response`,
            task: `${vendor.vendorName} reviewing counter-offer and preparing response...`,
        });

        let vendorReply: Record<string, any>;
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
                reasoning: 'Meeting halfway on margin to close the deal',
            };
        }

        const finalPrice: number = vendorReply.finalPrice ?? vendor.originalPrice;
        const savings = Math.max(0, +(vendor.originalPrice - finalPrice).toFixed(2));

        send('email_received', {
            from: vendor.vendorName, fromRole: 'Vendor', to: 'AutoRFP Procurement AI',
            subject: vendorReply.subject, body: vendorReply.body,
            decision: vendorReply.decision, finalPrice,
        });

        send('negotiation_round', {
            vendorName: vendor.vendorName,
            originalPrice: vendor.originalPrice,
            counterPrice: counterOffer.counterPrice ?? counterTarget,
            finalPrice,
            savings,
            decision: vendorReply.decision,
        });

        negotiationResults.push({ vendorName: vendor.vendorName, originalPrice: vendor.originalPrice, negotiatedPrice: finalPrice, savings, decision: vendorReply.decision });
    }

    // Non-targeted vendors: original price stands
    for (const vendor of quotes) {
        if (!negotiationResults.find(r => r.vendorName === vendor.vendorName)) {
            negotiationResults.push({ vendorName: vendor.vendorName, originalPrice: vendor.originalPrice, negotiatedPrice: vendor.originalPrice, savings: 0, decision: 'NOT_TARGETED' });
        }
    }

    return { negotiationResults };
}

// ─── Node: Finalize (Audit + DB writes + Buyer email) ─────────────────────────

async function finalizeNode(state: NegotiationStateType): Promise<Partial<NegotiationStateType>> {
    const { requestId, menuId, tenantId, quotes, negotiationResults, marketPrices, highestQuote } = state;
    const send = getSend(requestId);

    send('agent_start', {
        agent: AGENTS.auditor.name,
        emoji: AGENTS.auditor.emoji,
        role: AGENTS.auditor.role,
        task: 'Auditing all negotiated deals, calculating total savings, selecting final winner',
    });

    const totalSavings = negotiationResults.reduce((s, r) => s + r.savings, 0);
    const bestDeal = negotiationResults.reduce((best, curr) => curr.negotiatedPrice < best.negotiatedPrice ? curr : best);

    let auditResult: Record<string, any>;
    try {
        auditResult = await callAgent('auditor', `
Audit this procurement negotiation outcome:

Results by vendor:
${negotiationResults.map(r =>
    `  • ${r.vendorName}: $${r.originalPrice.toFixed(2)} → $${r.negotiatedPrice.toFixed(2)} | Saved: $${r.savings.toFixed(2)} | ${r.decision}`
).join('\n')}

Total savings achieved: $${totalSavings.toFixed(2)}
Best available price: ${bestDeal.vendorName} at $${bestDeal.negotiatedPrice.toFixed(2)}

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
            executiveSummary: `The agentic negotiation pipeline achieved $${totalSavings.toFixed(2)} in cost reductions. ${bestDeal.vendorName} emerged as the optimal supplier at $${bestDeal.negotiatedPrice.toFixed(2)}, offering the best combination of price and reliability. Recommend immediate order confirmation to lock in current pricing.`,
            actionItems: [
                `Confirm purchase order with ${bestDeal.vendorName} within 24 hours to secure negotiated pricing`,
                'Request written delivery schedule confirmation before order finalization',
            ],
            verdict: totalSavings > 60 ? 'EXCELLENT' : totalSavings > 20 ? 'GOOD' : 'ACCEPTABLE',
        };
    }

    send('agent_result', { agent: AGENTS.auditor.name, emoji: AGENTS.auditor.emoji, data: auditResult });

    // Persist final statuses to DB
    const winnerName = String(auditResult.winner ?? '').trim().toLowerCase();
    for (const result of negotiationResults) {
        const vendor = quotes.find(q => q.vendorName === result.vendorName);
        if (!vendor?.rfpId) continue;
        const isWinner = String(result.vendorName ?? '').trim().toLowerCase() === winnerName;
        const finalStatus = isWinner ? 'ACCEPTED' : 'DECLINED';
        await prisma.rFP.update({
            where: { id: vendor.rfpId },
            data: { status: finalStatus, acceptedAt: isWinner ? new Date() : undefined, negotiatedAt: new Date() },
        });
    }

    await prisma.menu.update({
        where: { id: menuId },
        data: { workflowStatus: 'NEGOTIATION_COMPLETE', lastActivityAt: new Date() },
    });

    // Ingest negotiation outcomes into ChromaDB for future RAG context
    for (const result of negotiationResults) {
        const vendor = quotes.find(q => q.vendorName === result.vendorName);
        const text = `Procurement decision: ${result.vendorName} (${vendor?.location ?? 'unknown'}) quoted $${result.originalPrice.toFixed(2)}, negotiated to $${result.negotiatedPrice.toFixed(2)}, saving $${result.savings.toFixed(2)}. Decision: ${result.decision}. Ingredients: ${Object.keys(marketPrices).join(', ') || 'N/A'}.`;
        try {
            const embedding = await getEmbedding(text);
            if (embedding) {
                await ingestQuote({
                    id: `${menuId}-${result.vendorName}-${Date.now()}`,
                    text,
                    embedding,
                    metadata: { tenantId, distributorName: result.vendorName, location: vendor?.location ?? '', price: result.negotiatedPrice, ingredients: Object.keys(marketPrices).join(', '), timestamp: new Date().toISOString() },
                });
            }
        } catch { /* non-critical */ }
    }

    // Email buyer report
    await sendBuyerReport({ winner: auditResult.winner, winnerPrice: auditResult.winnerFinalPrice, totalSavings: auditResult.totalSavingsAchieved, savingsPercentage: auditResult.savingsPercentage, verdict: auditResult.verdict, executiveSummary: auditResult.executiveSummary, actionItems: auditResult.actionItems ?? [], negotiationResults }, quotes);

    const completePayload = {
        winner: auditResult.winner ?? bestDeal.vendorName,
        winnerPrice: auditResult.winnerFinalPrice ?? bestDeal.negotiatedPrice,
        totalSavings: auditResult.totalSavingsAchieved ?? totalSavings,
        savingsPercentage: auditResult.savingsPercentage ?? +(totalSavings / highestQuote * 100).toFixed(1),
        verdict: auditResult.verdict ?? 'GOOD',
        executiveSummary: auditResult.executiveSummary,
        actionItems: auditResult.actionItems ?? [],
        negotiationResults,
    };

    return { auditResult, completePayload };
}

// ─── Buyer Report Email ───────────────────────────────────────────────────────

async function sendBuyerReport(result: any, quotes: QuoteItem[]) {
    if (process.env.AUTORFP_SEND_BUYER_REPORT !== 'true') return;
    const buyerEmail = process.env.BUYER_EMAIL;
    const resendKey = process.env.RESEND_API_KEY;
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
            <span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;
              background:${r.decision === 'ACCEPT' ? '#064e3b' : r.decision === 'COUNTER' ? '#451a03' : '#1f2937'};
              color:${r.decision === 'ACCEPT' ? '#10b981' : r.decision === 'COUNTER' ? '#f59e0b' : '#9ca3af'}">
              ${r.decision}
            </span>
          </td>
        </tr>`).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:40px 24px;">
    <div style="margin-bottom:32px;">
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#f9fafb;">Procurement Report</h1>
      <p style="margin:0;font-size:13px;color:#6b7280;">${now}</p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-left:4px solid ${verdictColor};border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#f9fafb;">${result.winner}</p>
      <p style="margin:4px 0 0;color:#d1d5db;">Final: <strong>$${Number(result.winnerPrice).toFixed(2)}</strong> · Saved: <strong style="color:#10b981;">−$${Number(result.totalSavings).toFixed(2)}</strong></p>
    </div>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#111827;">
          <th style="padding:10px 16px;text-align:left;font-size:10px;color:#6b7280;">Supplier</th>
          <th style="padding:10px 16px;text-align:right;font-size:10px;color:#6b7280;">Original</th>
          <th style="padding:10px 16px;text-align:right;font-size:10px;color:#6b7280;">Final</th>
          <th style="padding:10px 16px;text-align:right;font-size:10px;color:#6b7280;">Saved</th>
          <th style="padding:10px 16px;text-align:center;font-size:10px;color:#6b7280;">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:14px;color:#d1d5db;line-height:1.7;">${result.executiveSummary}</p>
    <p style="margin:32px 0 0;font-size:11px;color:#374151;text-align:center;">Generated by AutoRFP · ${now}</p>
  </div>
</body></html>`;

    try {
        await resend.emails.send({
            from: 'AutoRFP <onboarding@resend.dev>',
            to: buyerEmail,
            subject: `Procurement Report — ${result.winner} selected · −$${Number(result.totalSavings).toFixed(2)} saved`,
            html,
        });
    } catch (err: any) {
        console.error('[negotiate] Buyer report email failed:', err.message);
    }
}

// ─── LangGraph Pipeline ───────────────────────────────────────────────────────

const negotiationGraph = new StateGraph(NegotiationState)
    .addNode('loadData', loadDataNode)
    .addNode('orchestrate', orchestrateNode)
    .addNode('analyze', analyzeNode)
    .addNode('negotiate', negotiateNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'loadData')
    .addEdge('loadData', 'orchestrate')
    .addEdge('orchestrate', 'analyze')
    .addEdge('analyze', 'negotiate')
    .addEdge('negotiate', 'finalize')
    .addEdge('finalize', END)
    .compile();

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const menuId = searchParams.get('menuId');
    const tenantId = searchParams.get('tenantId') ?? 'tenant_demo';

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const requestId = crypto.randomUUID();
            const send = (event: string, data: object) => {
                try {
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                } catch { /* client disconnected */ }
            };

            if (!menuId) {
                send('error', { message: 'menuId is required' });
                controller.close();
                return;
            }

            _senders.set(requestId, send);

            try {
                const finalState = await negotiationGraph.invoke({ requestId, menuId, tenantId });
                if (finalState.completePayload) {
                    send('complete', finalState.completePayload);
                }
            } catch (error: any) {
                send('error', { message: error.message || 'Negotiation pipeline failed' });
            } finally {
                _senders.delete(requestId);
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
