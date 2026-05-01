# AutoRFP — Automated Ingredient Procurement System

> Built by Utsav Doshi · [github.com/Utsavd7](https://github.com/Utsavd7)

---

## What This Does

Every restaurant has to buy food. Every single week.

The chef or owner has to figure out: what do we need, how much of it, who sells it, what's the going rate, and are we getting a fair price? Then they call suppliers, wait for quotes, compare them manually, negotiate a little, and place an order. Then do it all over again next week.

**AutoRFP automates that entire process.**

You paste your menu in. The system figures out every ingredient you need — including the ones no one thinks about, like the butter used to finish a sauce or the stock a risotto is cooked in. It calculates realistic quantities based on your guest count. It looks up what those ingredients are actually trading for on commodity markets right now. It finds suppliers near you and emails them RFPs. It runs an AI negotiation to push for a better price. And it tells you exactly who to buy from and what you'll save.

What used to take hours of back-and-forth every week becomes something you click through in minutes.

---

## Why This Problem Is Worth Solving

Food is the single biggest controllable cost in a restaurant — typically 28–35% of revenue. Even small inefficiencies compound fast.

But the way most restaurants actually handle procurement hasn't changed much in decades:

- **No price visibility.** Suppliers quote whatever they want. Most restaurant owners have no idea if chicken breast is up 15% this month because of avian flu or if their beef distributor is padding margins. There's no live market signal in the room.
- **No negotiation leverage.** A single restaurant calling one supplier has almost none. There's no data, no comparison, and no time to shop around.
- **No memory.** Every procurement cycle starts from zero. Nobody knows what they paid last quarter, which vendor came in cheapest for salmon, or that the last time wheat spiked they should've locked in flour early.
- **It's all manual.** Phone calls, emails, spreadsheets. The chef is doing this on top of running a kitchen. It's the last thing anyone wants to spend time on.

The result: restaurants routinely overpay, miss pricing windows, and have no visibility into whether their food costs are trending in the right direction.

This is a real operational problem for the ~1 million restaurants in the US alone. Most of them are small businesses that can't afford a procurement team. That's exactly who this is built for.

---

## Why I Built This

I wanted to build something at the intersection of AI agents, live market data, and a real operational workflow — not a toy demo. Here's what made each piece tricky and how I handled it:

**Hidden ingredients** — A menu says "pan-seared salmon." That's one ingredient. But you also need butter, shallots, stock, lemon, and oil to actually cook it. None of that is written anywhere. I built a two-pass extraction: first pull what's on the menu, then a second pass infers the hidden cooking ingredients every kitchen uses but never advertises.

**Realistic quantities** — LLMs are terrible at this. They'll say 500g of garlic for 20 guests without blinking. So I removed AI from that decision. I built a lookup table of 40+ ingredient categories with real kitchen portion standards — salmon is 8oz per guest, pasta is 4oz, herbs are 0.25oz. The LLM says *what*, the app decides *how much*.

**Live market prices** — Ingredients map to real commodity futures tickers. Beef → live cattle futures on CME. Pasta → wheat futures on CBOT. Coffee → arabica on ICE. Prices pull from Yahoo Finance and convert to per-pound wholesale rates. Anything not on a futures market falls back to BLS retail data. Nothing is hardcoded.

**Real negotiation** — One prompt asking an LLM to "negotiate" just gets you a polite email. So I built 5 agents that run in sequence: Orchestrator sets the strategy, Market Analyst grounds it in live prices, Negotiator writes the counter-offer, Vendor Simulator plays the distributor pushing back, Deal Auditor checks the final terms. The whole thing streams live to the screen.

**Procurement memory** — Every completed run gets embedded and stored in ChromaDB. Next time you buy the same ingredient, the system pulls up what worked last time and uses it. It gets better with every cycle instead of forgetting everything.

---

## What Makes It Different

| | AutoRFP | Typical "AI for restaurants" |
|---|---|---|
| **Ingredient extraction** | Infers hidden ingredients (cooking fats, bases, finishes) · 6–10 per entree | Only extracts hero ingredients from menu text |
| **Portion accuracy** | 40+ keyword-mapped industry-standard kitchen portions per ingredient category | Generic quantities or LLM guesses |
| **Market pricing** | CME/CBOT/ICE futures + BLS retail series + dynamic year range | Static price tables or none |
| **Supplier discovery** | Google Places API near restaurant location · curated fallback pool | Hardcoded distributors |
| **Negotiation** | 5-agent SSE-streamed pipeline (Orchestrator → Market Analyst → Negotiator → Vendor Simulator → Deal Auditor) | Single LLM prompt |
| **Procurement memory** | ChromaDB RAG: past negotiation outcomes inform future recommendations | Stateless — forgets everything |
| **Multi-tenant SaaS** | Full NextAuth workspace with tenant-scoped history, analytics, and settings | Single-user or demo only |

---

## Core Features

**Menu → Procurement List**
Paste a menu URL or plain text. Groq extracts every dish, infers hidden procurement ingredients using culinary context, and applies deterministic per-guest portion defaults. One guest count scales the entire menu.

**Live Market Pricing**
Ingredients are matched to CME/CBOT/ICE futures tickers (beef, pork, wheat, corn, soy, coffee, sugar, cocoa, OJ) and BLS retail price series. Yahoo Finance dual-URL fallback keeps pricing live. Category-specific mock wholesale prices handle anything not covered by live data.

**ML Price Forecasting**
OLS linear regression on 6-month price history produces a 3-month forward forecast with 95% confidence intervals. Z-score anomaly detection (|z| > 1.4) generates buy/wait/neutral signals and price spike alerts.

**5-Agent Negotiation Pipeline (SSE streamed)**
1. **Orchestrator** — coordinates the run
2. **Market Analyst** — anchors the negotiation with live commodity context
3. **Negotiation Agent** — crafts the counter-offer strategy
4. **Vendor Simulator** — plays the distributor responding to pressure
5. **Deal Auditor** — validates the final deal terms and flags red flags

**RAG Procurement Memory**
Past negotiation outcomes are embedded (Ollama `nomic-embed-text` or deterministic fallback) and stored in ChromaDB. Before each recommendation, similar past runs are retrieved and injected as context so the system compounds learning across procurement cycles.

**Automatic RFP Dispatch**
Compiled ingredient lists are emailed to discovered suppliers via Resend. Vendors can respond through a quote portal at `/quote/[rfpId]`.

**Procurement History & Intelligence**
Every completed run is saved to Postgres. The Intelligence page shows spend trends, savings analytics, price spike alerts, category breakdown, and supplier scorecards across all runs.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 App Router + TypeScript |
| Auth | NextAuth v4 · Credentials provider · JWT sessions |
| Database | PostgreSQL via Prisma ORM (Supabase or local) |
| Cloud LLM | Groq `llama-3.3-70b-versatile` |
| Local LLM | Ollama `llama3.2` (optional) |
| Embeddings | Ollama `nomic-embed-text` · deterministic fallback |
| Vector store | ChromaDB (optional) |
| Market data | Yahoo Finance (CME/CBOT/ICE futures) · BLS public API |
| ML | OLS linear regression · Z-score anomaly detection |
| Email | Resend API |
| Supplier search | Google Places API · curated fallback pool |
| Streaming | Server-Sent Events (SSE) for negotiation transcript |
| Styling | Tailwind CSS |

---

## Project Structure

```text
src/
  app/
    page.tsx                         Landing / sign-in / sign-up
    (app)/
      dashboard/page.tsx             Procurement dashboard
      procurement/page.tsx           New procurement workflow
      history/page.tsx               Tenant-scoped run history
      intelligence/page.tsx          Price alerts, analytics, scorecards
      settings/page.tsx              Restaurant profile and integrations
    demo-seed/page.tsx               Postgres-backed demo workspace seed
    quote/[rfpId]/page.tsx           Vendor quote portal
    api/
      auth/[...nextauth]/route.ts    NextAuth credentials session
      account/route.ts               Current tenant profile
      dashboard/route.ts             Tenant dashboard + history
      history/route.ts               Procurement history
      demo/seed-account/route.ts     Demo account seed
      demo/seed-rag/route.ts         Demo ChromaDB RAG seed
      parse-menu/route.ts            Dish + hidden ingredient extraction
      pricing/route.ts               Live market pricing (futures + BLS)
      ml/forecast/route.ts           OLS forecast + anomaly detection
      distributors/route.ts          Supplier search
      send-rfp/route.ts              RFP email dispatch
      simulate-conversation/route.ts Quote simulation
      recommend/route.ts             AI recommendation + RAG context
      agent/negotiate/route.ts       SSE 5-agent negotiation pipeline
  lib/
    auth.ts                          NextAuth options
    tenant.ts                        Tenant types + browser fallback helpers
    llm.ts                           Ollama/Groq chat helpers
    embeddings.ts                    Ollama/fallback embeddings
    chroma.ts                        ChromaDB RAG memory client

prisma/schema.prisma                 Prisma schema
demo.sh                              One-command local demo setup
.env.sample                          Environment template
```

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/Utsavd7/AutoRFP-Automated-Ingredient-Procurement-System.git
cd AutoRFP-Automated-Ingredient-Procurement-System
npm install
```

### 2. Configure environment

```bash
cp .env.sample .env
```

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Use Supabase or local Postgres. |
| `NEXTAUTH_URL` | Yes | App URL — `http://localhost:3000` locally. |
| `NEXTAUTH_SECRET` | Yes | Session signing secret. Run `openssl rand -base64 32`. |
| `GROQ_API_KEY` | Yes | Cloud LLM for parsing, negotiation, quotes. Get one at [console.groq.com](https://console.groq.com/keys). |
| `GOOGLE_MAPS_API_KEY` | Optional | Real supplier discovery via Google Places. |
| `RESEND_API_KEY` | Optional | RFP email delivery. Without it, RFPs are stored/logged only. |
| `MOCK_EMAIL` | Optional | Routes all demo vendor emails to one inbox. |
| `AUTORFP_SEND_BUYER_REPORT` | Optional | Set `true` to email the final buyer report. |
| `BUYER_EMAIL` | Optional | Recipient for buyer reports. |
| `CHROMA_URL` | Optional | ChromaDB URL. Defaults to `http://localhost:8000`. |
| `OLLAMA_URL` | Optional | Ollama URL. Defaults to `http://localhost:11434`. |

### 3. Initialize the database

```bash
npx prisma generate
npx prisma db push
```

### 4. Optional: local AI services

Ollama for local/private inference:
```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

ChromaDB for RAG procurement memory:
```bash
chroma run --path ./chroma_data
```

Both are optional — the app degrades gracefully without them.

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create a restaurant workspace, and paste a menu.

---

## Quick Demo

```bash
./demo.sh
```

This starts ChromaDB (if available), starts Next.js, seeds RAG memory, and opens a pre-seeded demo workspace. After sign-out:

```
email: demo@autorfp.local
password: demo-password
```

### Sample menus to try

**Real restaurant URL** — paste directly into the menu input:
```
https://carminesnyc.com/menus/menus-c44-q420-dining#
```

**Plain text** — paste into New Procurement:
```
Classic Cheeseburger $14
Spaghetti Carbonara $18
Grilled Salmon $26
Chicken Parmesan $22
Caesar Salad $14
Margherita Pizza $16
Eggs Benedict $13
Tiramisu $10
```

---

## AI Fallback Behavior

| Capability | Primary | Fallback |
|---|---|---|
| Menu parsing | Groq `llama-3.3-70b-versatile` | Groq enrichment pass fills missing ingredients |
| Recommendations | Ollama + Groq comparison | Groq-only when Ollama is down |
| Negotiation | Groq `llama-3.3-70b-versatile` | Error toast if `GROQ_API_KEY` missing |
| Embeddings | Ollama `nomic-embed-text` | Deterministic 768-dim local fallback |
| RAG memory | ChromaDB | Skipped gracefully if ChromaDB is down |

Missing local services never take down the app.

---

## What's Next

- Move active RFP state from localStorage to Postgres for multi-device support
- Add team member roles within a restaurant workspace
- Vendor-facing quote lifecycle: status tracking, reminders, buyer review states
- Production email/domain setup for real supplier outreach
- Observability for failed AI calls and slow API routes
- Regression tests around auth isolation and tenant-scoped APIs

---

## License

MIT
