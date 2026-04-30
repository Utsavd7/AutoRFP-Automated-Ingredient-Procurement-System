# AutoRFP - Intelligent Restaurant Procurement

AutoRFP is a SaaS-style procurement workspace for restaurants. It turns menus into ingredient demand, prices the basket against market data, finds suppliers, collects quotes, negotiates with AI agents, and tracks savings over time.

The demo is designed to degrade gracefully: Groq powers the cloud AI path, Ollama is optional local acceleration/privacy, and ChromaDB is optional RAG memory.

---

## Product Surface

- Landing and sign-in/sign-up flow with tenant-scoped restaurant workspaces.
- Persistent app sidebar: Dashboard, New Procurement, History, Intelligence, Settings.
- Dashboard with active RFPs, savings to date, last negotiation outcome, and market alerts.
- New Procurement workbench with menu parsing, market pricing, supplier discovery, quote collection, AI recommendation, and SSE negotiation stream.
- Meal order sizing: select one extracted dish, enter guest count, apply a buffer, then procure only the scaled ingredients for that event.
- Procurement History with spend, savings, best vendor, and "run again" retention flow.
- Intelligence page with price spike alerts, savings analytics, category savings, and supplier scorecards.
- Restaurant Settings for profile, budget targets, preferred suppliers, and integration status.
- Vendor quote portal at `/quote/[rfpId]`.

---

## Demo Setup

The fastest way to run the project for an interview/demo:

```bash
./demo.sh
```

The script:

1. Starts ChromaDB on `:8000` if the `chroma` command is available.
2. Starts Next.js on `:3000` if it is not already running.
3. Calls `/api/demo/seed-rag` to seed sample Chroma/RAG memories.
4. Opens `/demo-seed`, which creates a local demo restaurant workspace and redirects to the dashboard.

Demo credentials after sign out:

```text
email: demo@autorfp.local
password: demo-password
```

If ChromaDB is unavailable, the app still runs. If Ollama is unavailable, AI chat calls fall back to Groq and embeddings use a deterministic local fallback so the demo does not crash.

---

## Manual Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.sample .env
```

Edit `.env` with your values.

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for Prisma. |
| `NEXTAUTH_URL` | Yes | Local app URL, usually `http://localhost:3000`. |
| `NEXTAUTH_SECRET` | Yes | Session signing secret. Generate with `openssl rand -base64 32`. |
| `GROQ_API_KEY` | Yes for full AI demo | Cloud LLM fallback and negotiation pipeline. Get one at `https://console.groq.com/keys`. |
| `GOOGLE_MAPS_API_KEY` | Optional | Real supplier discovery through Google Places. Without it, curated suppliers are used. |
| `RESEND_API_KEY` | Optional | Real RFP/report email delivery. Without it, RFPs are stored/logged only. |
| `MOCK_EMAIL` | Optional | Routes demo vendor emails to one inbox. |
| `AUTORFP_SEND_BUYER_REPORT` | Optional | Set to `true` to email the final buyer report. |
| `BUYER_EMAIL` | Optional | Recipient for buyer reports when enabled. |
| `CHROMA_URL` | Optional | ChromaDB URL, defaults to `http://localhost:8000`. |
| `OLLAMA_URL` | Optional | Ollama URL, defaults to `http://localhost:11434`. |

### 3. Initialize the database

```bash
npx prisma generate
npx prisma db push
```

### 4. Optional local services

Ollama is optional. Use it for local/private inference and embeddings:

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

ChromaDB is optional. Use it for vector RAG memory:

```bash
chroma run --path ./chroma_data
```

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## AI Behavior

| Capability | Primary path | Fallback path |
|---|---|---|
| Menu parsing | Ollama `llama3.2` when available | Groq `llama-3.3-70b-versatile` |
| Recommendations | Ollama + Groq comparison when both are available | Groq result when local model is down |
| Agent negotiation | Groq `llama-3.3-70b-versatile` | Helpful API/toast error if `GROQ_API_KEY` is missing |
| Embeddings | Ollama `nomic-embed-text` | Deterministic 768-dim local embedding fallback |
| RAG memory | ChromaDB at `CHROMA_URL` | Skipped gracefully if ChromaDB is down |

The goal is simple: missing local services should never take down the demo.

---

## Data Sources

| Source | Key required | Used for |
|---|---:|---|
| Groq API | Yes | Cloud LLM fallback, quote simulation, and negotiation agents. |
| Ollama | No | Optional local chat model and embeddings. |
| ChromaDB | No | Optional vector store for tenant-scoped procurement memory. |
| Google Places API | Optional | Real supplier search near the restaurant location. |
| Yahoo Finance | No | Futures pricing for meat, grains, coffee, sugar, cocoa, and related commodities. |
| BLS public data | No | Retail price context for common ingredients. |

---

## Project Structure

```text
src/
  app/
    page.tsx                         Landing/login/signup
    (app)/
      dashboard/page.tsx             Procurement dashboard
      procurement/page.tsx           New procurement workflow
      history/page.tsx               Tenant-scoped procurement history
      intelligence/page.tsx          Alerts, analytics, scorecards
      settings/page.tsx              Restaurant profile and integrations
    demo-seed/page.tsx               Browser localStorage demo workspace seed
    quote/[rfpId]/page.tsx           Vendor quote portal
    api/
      auth/[...nextauth]/route.ts    NextAuth credentials session
      demo/seed-rag/route.ts         Demo Chroma/RAG seed endpoint
      parse-menu/route.ts            Menu extraction
      pricing/route.ts               Market pricing
      distributors/route.ts          Supplier search
      send-rfp/route.ts              RFP dispatch
      simulate-conversation/route.ts Quote simulation
      recommend/route.ts             AI recommendation + RAG context
      agent/negotiate/route.ts       SSE agent negotiation pipeline
  components/
    Skeleton.tsx                     Reusable skeleton loading UI
    ToastViewport.tsx                Toast notification viewport
  lib/
    auth.ts                          NextAuth options
    tenant.ts                        Tenant account/history helpers
    llm.ts                           Ollama/Groq chat helpers
    embeddings.ts                    Ollama/fallback embeddings
    chroma.ts                        ChromaDB RAG memory client

prisma/schema.prisma                 Prisma schema
demo.sh                              One-command local demo setup
.env.sample                          Environment template
```

---

## SaaS Notes

- Auth is credentials-based via NextAuth, with demo-friendly local tenant account persistence.
- Tenant IDs are deterministic from restaurant email/name and used to scope dashboard, history, active RFP state, and RAG metadata.
- Each restaurant profile stores location, cuisine type, preferred suppliers, monthly budget target, and savings target.
- Procurement history is tenant-scoped and powers analytics, supplier scorecards, market alerts, and the "run again" flow.

---

## Demo Menu

### Real Restaurant URL

Paste either of these directly into the menu input field:

```text
https://carminesnyc.com/menus/menus-c44-q420-dining#
```

```text
https://www.tavernonthegreen.com/menu/
```

AutoRFP fetches the page server-side, strips all HTML, and passes clean text to the LLMs. Carmine's NYC is a large Italian-American menu with dozens of dishes - great for demoing bulk ingredient extraction. Tavern on the Green is useful as a second polished restaurant sample for testing higher-end menu language.

### Plain Text Sample

Paste this into New Procurement:

```text
Classic Cheeseburger $14
Spaghetti Carbonara $18
Grilled Salmon $26
Chicken Parmesan $22
Caesar Salad $14
Margherita Pizza $16
Eggs Benedict $13
Tiramisu $10
```

Or use the built-in sample menu button in the app.
