# AutoRFP — Intelligent Procurement Platform

AutoRFP automates the entire restaurant ingredient procurement pipeline in five steps — from AI menu parsing through live market pricing, supplier discovery, vendor quote collection, and fully autonomous multi-agent price negotiation.

---

## Demo walkthrough

1. **Paste a menu** (text or URL) → Ollama (llama3.2, local) extracts every dish and ingredient; Groq cross-verifies the result
2. **Run Market Analysis** → live CME/CBOT futures + BLS retail prices + ML price forecasting with anomaly detection
3. **Find Suppliers** → real distributors via Google Places API (50 km radius); curated pool as fallback
4. **Generate vendor responses** → Groq simulates multi-turn email negotiations grounded in real quantities × market prices
5. **Launch Agent Pipeline** → 5 specialized AI agents negotiate autonomously via SSE-streamed email thread

---

## Features

### AI & ML
| Feature | How it works |
|---|---|
| Menu parsing | Ollama llama3.2 (local, primary) → Groq llama-3.3-70b (fallback). Both return structured JSON; source shown in UI |
| Dual-LLM verification | Recommendation step runs both models in parallel; compares picks and shows agreement score + confidence % |
| Price forecasting | OLS linear regression on 6-month price history; 3-month forward projection with 95% confidence intervals |
| Anomaly detection | Z-score on ingredient price history; flags SPIKE / DIP at \|z\| > 1.4 |
| Buy/Wait signals | Derived from trend direction + anomaly type; e.g. DIP → BUY\_NOW, SPIKE + RISING → WAIT |
| Quote simulation | Multi-turn Groq conversation grounded in `quantity × market_price` per ingredient; vendors quote at 5–20% margin |
| AI recommendation | Ollama + Groq both analyze quotes independently; final answer shows which distributor each model chose and whether they agree |
| 5-agent negotiation | Server-Sent Events pipeline: Orchestrator → Market Analyst → Negotiation Agent (per vendor) ↔ Vendor Simulator → Deal Auditor |

### Data sources
| Source | Key required | Used for |
|---|---|---|
| Ollama (local) | No | Primary LLM — menu parsing and recommendations |
| Groq API | Yes (free) | Cross-verifier LLM + negotiation pipeline |
| Google Places API | Yes (billing) | Real food distributor search by location |
| Yahoo Finance | No | CME Live Cattle, CME Lean Hogs, CBOT Wheat/Corn/Soybeans/Oats, ICE Coffee/Sugar/Cocoa/OJ |
| BLS Public API | No | Retail prices — chicken, eggs, milk, butter, cheese, produce |

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, serverless API routes) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Charts | Recharts (ComposedChart — Area + dashed Line for forecast overlay) |
| Icons | Lucide React |
| Primary LLM | Ollama — llama3.2 running locally at `localhost:11434` |
| Cross-verifier LLM | Groq API via OpenAI SDK (`baseURL: https://api.groq.com/openai/v1`, model: `llama-3.3-70b-versatile`) |
| Streaming | Server-Sent Events (`ReadableStream` + `EventSource`) |
| Database | PostgreSQL via Prisma ORM |
| Supplier search | Google Places Text Search API |

---

## Project structure

```
src/
├── lib/
│   └── llm.ts                            # Shared Ollama + Groq clients and helpers
└── app/
    ├── page.tsx                          # Main UI — 5-step procurement pipeline
    ├── quote/[rfpId]/page.tsx            # Vendor self-serve quote portal
    └── api/
        ├── parse-menu/route.ts           # Ollama → Groq menu parsing (text or URL)
        ├── pricing/route.ts              # Yahoo Finance → BLS → estimated fallback
        ├── ml/forecast/route.ts          # OLS regression, z-score anomaly, buy signals
        ├── distributors/route.ts         # Google Places → curated pool fallback
        ├── send-rfp/route.ts             # RFP dispatch (Resend if key set, else logged)
        ├── simulate-conversation/route.ts # Groq multi-turn vendor negotiation
        ├── quotes/route.ts               # Fetch quotes by menuId
        ├── recommend/route.ts            # Dual-LLM recommendation with verification
        ├── agent/negotiate/route.ts      # 5-agent SSE negotiation pipeline
        └── webhooks/inbound-email/route.ts # Parse manual vendor email replies

prisma/schema.prisma                      # DB schema
.env.sample                               # Environment variable template
```

---

## Database schema

```
Menu ──< Recipe ──< Ingredient ──< PricingTrend
Menu ──< RFP ──< Quote
Distributor ──< RFP
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Install Ollama and pull the model

```bash
# Install Ollama: https://ollama.com
ollama pull llama3.2
```

Ollama runs locally — no API key, no cost, no rate limits.

### 3. Configure environment

```bash
cp .env.sample .env
```

Edit `.env` with your values:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection |
| `GROQ_API_KEY` | ✅ | Cross-verifier LLM + negotiation — free at [console.groq.com/keys](https://console.groq.com/keys) |
| `GOOGLE_MAPS_API_KEY` | ✅ | Real distributor search — [console.cloud.google.com](https://console.cloud.google.com), enable Places API + billing |
| `RESEND_API_KEY` | Optional | Real email delivery — free at [resend.com](https://resend.com) |
| `MOCK_EMAIL` | Optional | Route all demo emails to one address |

### 4. Initialize the database

```bash
npx prisma generate
npx prisma db push
```

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Sample menus for testing

### Option 1 — Real restaurant URL

Paste this directly into the menu input field:

```
https://carminesnyc.com/menus/menus-c44-q420-dining#
```

AutoRFP fetches the page server-side, strips all HTML, and passes clean text to the LLMs. Carmine's NYC is a large Italian-American menu with dozens of dishes — great for demoing bulk ingredient extraction.

### Option 2 — Click "Load sample →"

Pre-fills a diverse 8-dish menu optimized to trigger live prices across multiple data sources (beef → CME, chicken/eggs → BLS, pasta → CBOT, salmon → futures proxy, coffee → ICE).

### Option 3 — Plain text

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

## Architecture notes

**Why dual LLM (Ollama + Groq)?**
Ollama runs llama3.2 locally — zero cost, zero latency overhead, fully private. Groq runs llama-3.3-70b in the cloud as a cross-verifier. For menu parsing, Ollama is the primary and Groq is fallback. For supplier recommendations, both models run in parallel and their picks are compared — if they agree, confidence is 96%; if they differ, both choices are shown so the user can decide.

**Why Google Places for suppliers?**
Google Places Text Search returns real, up-to-date businesses including Sysco branches, Restaurant Depot, food co-ops, and regional distributors — far more accurate than OSM tags for commercial food distribution. Falls back to a curated pool of 15 known distributors when the API returns no results.

**Why no email sending by default?**
RFPs are generated and tracked in the database but not delivered to real vendors unless `RESEND_API_KEY` is set. The vendor side is simulated by Groq to complete the demo loop without spamming real inboxes.

**Pricing fallback chain:**
1. Yahoo Finance futures (live, no key) — meat, grains, soy, oats, coffee, sugar, cocoa, OJ
2. BLS Public API (live, no key) — chicken, eggs, milk, butter, cheese, produce
3. Deterministic estimate based on ingredient name hash — everything else
4. DB cache — if the same ingredient was priced this calendar month, skip external calls
