# AutoRFP — Intelligent Procurement Platform

AutoRFP automates the entire restaurant ingredient procurement pipeline in five steps — from AI menu parsing through live market pricing, supplier discovery, vendor quote collection, and fully autonomous multi-agent price negotiation.

---

## Demo walkthrough

1. **Paste a menu** (text or URL) → Groq LLaMA 3.3 70B extracts every dish and ingredient
2. **Run Market Analysis** → live CME/CBOT commodity futures + ML price forecasting with anomaly detection
3. **Find Suppliers** → geosearch via OpenStreetMap/Overpass; curated pool of 15 real distributors as fallback
4. **Auto-simulate vendor responses** → Groq negotiates multi-turn email conversations grounded in real quantities × market prices
5. **Launch Agent Pipeline** → 5 specialized AI agents negotiate autonomously via SSE-streamed email thread

---

## Features

### AI & ML
| Feature | How it works |
|---|---|
| Menu parsing | Groq LLaMA 3.3 70B with `response_format: json_object`; URL inputs fetch page HTML server-side and strip to readable text before sending |
| Price forecasting | OLS linear regression on 6-month price history; 3-month forward projection with 95% confidence intervals |
| Anomaly detection | Z-score on ingredient price history; flags SPIKE / DIP at \|z\| > 1.4 |
| Buy/Wait signals | Derived from trend direction + anomaly type; e.g. DIP → BUY\_NOW, SPIKE + RISING → WAIT |
| Quote simulation | Multi-turn Groq conversation grounded in `quantity × market_price` per ingredient; vendors quote at 5–20% margin |
| AI recommendation | Groq compares all quotes against live market prices from DB and returns structured reasoning |
| 5-agent negotiation | Server-Sent Events pipeline: Orchestrator → Market Analyst → Negotiation Agent (per vendor) ↔ Vendor Simulator → Deal Auditor |

### Data sources (all free, no API key)
| Source | Used for |
|---|---|
| Yahoo Finance (`query1.finance.yahoo.com`) | CME Live Cattle (LE=F), CME Lean Hogs (HE=F), CBOT Wheat (ZW=F), CBOT Corn (ZC=F), CBOT Soybeans (ZS=F), CBOT Oats (ZO=F) |
| Nominatim (OpenStreetMap) | Geocode user-supplied city/zip to lat/lon |
| Overpass API | OSM POI search for wholesale/food businesses within 30 km |
| Curated mock pool | 15 real distributor names (Sysco, US Foods, Gordon Food Service, etc.); seeded Fisher-Yates shuffle gives consistent results per location |

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, serverless API routes) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Charts | Recharts (ComposedChart — Area + dashed Line for forecast overlay) |
| Icons | Lucide React |
| AI | Groq API via OpenAI SDK (`baseURL: https://api.groq.com/openai/v1`, model: `llama-3.3-70b-versatile`) |
| Streaming | Server-Sent Events (`ReadableStream` + `EventSource`) |
| Database | PostgreSQL via Prisma ORM |

---

## Project structure

```
src/app/
├── page.tsx                          # Main UI — 5-step procurement pipeline
├── quote/[rfpId]/page.tsx            # Vendor self-serve quote portal
└── api/
    ├── parse-menu/route.ts           # Groq menu parsing (text or URL)
    ├── pricing/route.ts              # Live Yahoo Finance + deterministic mock fallback
    ├── ml/forecast/route.ts          # OLS regression, z-score anomaly, buy signals
    ├── distributors/route.ts         # Nominatim → Overpass → seeded mock pool
    ├── send-rfp/route.ts             # RFP dispatch (logged, not emailed for safety)
    ├── simulate-conversation/route.ts # Groq multi-turn vendor negotiation
    ├── quotes/route.ts               # Fetch quotes by menuId
    ├── recommend/route.ts            # Groq AI supplier recommendation
    ├── agent/negotiate/route.ts      # 5-agent SSE negotiation pipeline
    └── webhooks/inbound-email/route.ts # Parse manual vendor email replies

prisma/schema.prisma                  # DB schema
.env.sample                           # Required environment variables (template)
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

### 2. Configure environment

```bash
cp .env.sample .env
```

Edit `.env` with your values:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection |
| `GROQ_API_KEY` | ✅ | All AI/LLM features — free at [console.groq.com/keys](https://console.groq.com/keys) |
| `MOCK_EMAIL` | Optional | Route all demo emails to one address instead of `@autorfp.demo` |

No Google Maps key, no USDA key, no paid APIs required.

### 3. Initialize the database

```bash
npx prisma generate
npx prisma db push
```

### 4. Run

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

AutoRFP fetches the page server-side, strips all HTML, and passes clean text to Groq. Carmine's NYC is a large Italian-American menu with dozens of dishes — great for demoing bulk ingredient extraction.

### Option 2 — Plain text

```
Classic Cheeseburger $12
Spaghetti Carbonara $18
Grilled Salmon $24
Caesar Salad $14
Margherita Pizza $16
```

---

## Architecture notes

**Why Groq instead of OpenAI?**
Groq's free tier has very high rate limits and near-instant inference on LLaMA 3.3 70B — well-suited for a demo that makes 6–10 sequential LLM calls in the negotiation pipeline. The OpenAI SDK is used via `baseURL` override; no OpenAI account required.

**Why no email sending?**
RFPs are generated and tracked in the database but not delivered to real vendors. This is intentional — the vendor side is simulated by the Groq Vendor Simulator agent to complete the demo loop without spamming real inboxes.

**Why deterministic mock distributors?**
A seeded Fisher-Yates shuffle (djb2 hash of the location string) ensures the same city always returns the same 5 distributors. This makes demos reproducible.

**Pricing fallback chain:**
1. Yahoo Finance futures (live, no key) for meat/grain/soy/oat ingredients
2. Deterministic mock based on ingredient name hash for everything else
3. DB cache — if the same ingredient was priced this calendar month, return cached data
