# AutoRFP — Automated Ingredient Procurement System

> Built by Utsav Doshi · [github.com/Utsavd7](https://github.com/Utsavd7)

---

## Current Status

AutoRFP is in a production-safety rebuild. The default application currently supports authenticated restaurant workspaces, pasted menu text, a saved menu draft, guest-based quantity scaling, and a reviewable ingredient demand draft. It does not send supplier requests, present market estimates as verified evidence, accept public supplier quotes, simulate supplier replies, or run negotiation workflows in the production-safe default.

The earlier pricing, supplier discovery, quote simulation, background-job, public quote, and agent negotiation modules remain quarantined behind explicit legacy-demo flags while they are replaced and verified. They are not production capabilities.

The approved target is an India-first procurement workflow for 1 to 10 restaurant users initially, designed to scale beyond 20. The target includes reviewed supplier outreach, traceable price evidence, a secure quote portal, reliable delivery processing, and tenant-isolated procurement records. Those capabilities will only move into the current feature set after their production gates are complete.

## What the Safe Baseline Does

Every restaurant has to buy food. Every single week.

The chef or owner has to figure out: what do we need, how much of it, who sells it, what's the going rate, and are we getting a fair price? Then they call suppliers, wait for quotes, compare them manually, negotiate a little, and place an order. Then do it all over again next week.

You paste menu text, review the extracted dishes, enter a guest count and buffer, and generate a combined ingredient demand draft. The workflow stops there by default. The interface states clearly that no supplier request has been sent.

---

## Why This Problem Is Worth Solving

Food is the single biggest controllable cost in a restaurant — typically 28–35% of revenue. Even small inefficiencies compound fast.

But the way most restaurants actually handle procurement hasn't changed much in decades:

- **No price visibility.** Suppliers quote whatever they want. Most restaurant owners have no idea if chicken breast is up 15% this month because of avian flu or if their beef distributor is padding margins. There's no live market signal in the room.
- **No negotiation leverage.** A single restaurant calling one supplier has almost none. There's no data, no comparison, and no time to shop around.
- **No memory.** Every procurement cycle starts from zero. Nobody knows what they paid last quarter, which vendor came in cheapest for salmon, or that the last time wheat spiked they should've locked in flour early.
- **It's all manual.** Phone calls, emails, spreadsheets. The chef is doing this on top of running a kitchen. It's the last thing anyone wants to spend time on.

The result: restaurants routinely overpay, miss pricing windows, and have no visibility into whether their food costs are trending in the right direction.

This is a real operational problem for independent restaurants without a dedicated procurement team. The approved rollout starts in India with 1 to 10 restaurant users, then expands after the safety and reliability gates are proven.

---

## Why I Built This

I wanted to explore the intersection of procurement automation, market evidence, and restaurant operations. The original prototype tested the ideas below. During the production-safety rebuild, only menu drafting and quantity review are enabled by default; the rest are quarantined prototype modules or approved target capabilities.

**Hidden ingredient prototype** — The original experiment used model inference to add likely cooking ingredients. The production-safe parser does not invent ingredients that are absent from the submitted menu text. Operator-reviewed recipe enrichment is an approved target.

**Realistic quantities** — LLMs are terrible at this. They'll say 500g of garlic for 20 guests without blinking. So I removed AI from that decision. I built a lookup table of 40+ ingredient categories with real kitchen portion standards — salmon is 8oz per guest, pasta is 4oz, herbs are 0.25oz. The LLM says *what*, the app decides *how much*.

**Market evidence prototype** — The legacy module maps some ingredients to commodity and retail series, then derives estimates. Those estimates are not currently presented as verified supplier-market evidence. The approved target requires source attribution, freshness, units, and India-relevant coverage.

**Negotiation prototype** — The legacy demo contains five typed LangGraph nodes and SSE event streaming. It is not enabled in the production-safe workflow and is not considered production-ready negotiation.

**Parallel quote simulation prototype** — The quarantined legacy demo can simulate multiple vendor responses in parallel. Simulated replies are not real supplier quotes and are never shown as production results.

**Background-job prototype** — Legacy Inngest functions exist in the repository, but production delivery, retry, idempotency, and monitoring guarantees are not complete.

**Tenant safety baseline** — Internal API routes derive tenant identity from authenticated sessions, and tenant-owned quote writes use scoped transactional checks. A complete model-by-model isolation audit remains an exit gate before public launch.

**Procurement memory prototype** — Optional ChromaDB integration code exists in the quarantined recommendation workflow. The production-safe default does not use generated memory to influence procurement decisions.

---

## Current Baseline and Approved Target

| Area | Current production-safe default | Approved target |
|---|---|---|
| Menu input | Bounded pasted text | Reviewed import options with explicit source handling |
| Demand planning | Saved menu draft and deterministic guest scaling | Versioned demand plans with operator approval |
| Market evidence | Disabled | Traceable India-relevant evidence with source, timestamp, and unit |
| Supplier outreach | Disabled | Reviewed requests through a production email provider |
| Supplier quotes | Public portal disabled | Secure tokenized quote collection and audit history |
| Recommendation and negotiation | Disabled | Evidence-grounded recommendations with human approval |
| Background processing | Legacy handlers disabled | Idempotent jobs with retries, observability, and recovery procedures |
| Tenant isolation | Session-derived tenant guards on internal routes | Completed model and route audit with adversarial tests |

---

## Enabled Core Features

**Menu to Procurement List**
Paste bounded menu text. The application saves a menu draft and applies deterministic per-guest quantity rules. One guest count scales the reviewed menu into a combined ingredient list.

**Safe Stop Before External Action**
After quantity entry, the default workflow stops at `Demand draft ready for review`. Supplier outreach, market evidence, quote collection, recommendation, risk scoring, simulation, and negotiation controls are hidden.

## Quarantined Legacy Modules

The following modules are retained temporarily for replacement work and local legacy demonstrations. Server routes fail closed unless `AUTORFP_ENABLE_LEGACY_DEMO=true` outside production, and client controls require `NEXT_PUBLIC_AUTORFP_ENABLE_LEGACY_DEMO=true`. Production ignores the server legacy flag.

**Market Pricing Prototype**
The legacy demo can request commodity and retail series and can produce category-based estimates. Results are prototype estimates, not current supplier evidence.

**ML Price Forecasting Prototype**
The legacy module contains OLS forecasting and anomaly heuristics. It is disabled by default, and its output is not production market evidence.

**5-Node LangGraph Negotiation Pipeline (SSE streamed)**

The negotiation pipeline is built as a typed `StateGraph` with five nodes:

1. **loadData** — loads legacy demo quotes and estimates
2. **orchestrate** — sets a simulated strategy and target vendors
3. **analyze** — reads prototype pricing context
4. **negotiate** — drafts counter-offers and simulates vendor responses
5. **finalize** — summarizes simulated outcomes

The graph and its SSE events are implementation experiments. They are inaccessible in the default product and carry no production delivery or outcome guarantee.

**Inngest Background Jobs**
Three legacy background function definitions are registered at `/api/inngest`: pricing refresh, RFP processing, and archival. The route is quarantined. Retry, idempotency, delivery, and recovery behavior still require production verification.

**Tenant Isolation Baseline**
Authenticated internal routes derive their tenant from the session, and sensitive quote writes use tenant-aware transactional conditions. The existing Prisma extension is defense in depth, not a claim that every model and operation has passed the final isolation audit.

**RAG Procurement Memory Prototype**
Optional Ollama and ChromaDB integration code remains in the legacy recommendation workflow. It is disabled in the production-safe default.

**RFP and Quote Prototype**
Legacy code exists for RFP records, email-provider experiments, a public quote page, and simulated quote collection. These paths are disabled by default. The public quote page returns a static unavailable state without loading an RFP while disabled.

**Error Monitoring**
`@sentry/nextjs` captures exceptions with stack traces and component context. Every authenticated page is wrapped in a React `ErrorBoundary` class component that shows a recovery UI and reports to Sentry on `componentDidCatch`. Set `NEXT_PUBLIC_SENTRY_DSN` to activate; the app runs normally without it.

**Procurement History and Intelligence**
History and intelligence screens can display stored records. The safe default does not create a completed supplier procurement run, so simulated savings and supplier outcomes are not presented as real results.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 App Router + TypeScript |
| Auth | NextAuth v4 · Credentials provider · JWT sessions |
| Database | PostgreSQL via Prisma ORM (Supabase or local) |
| Pipeline | LangGraph prototype, legacy demo only |
| Background jobs | Inngest prototype, quarantined |
| Cloud LLM | Groq integration, optional legacy demo only |
| Local LLM | Ollama `llama3.2` (optional) |
| Embeddings | Ollama `nomic-embed-text` · deterministic fallback |
| Vector store | ChromaDB (optional) |
| Market data | Prototype Yahoo Finance and BLS connectors, quarantined |
| ML | Prototype OLS regression and anomaly heuristic, quarantined |
| Email | Prototype Resend connector, quarantined |
| Supplier search | Prototype Google Places connector, quarantined |
| Streaming | Prototype SSE negotiation transcript, quarantined |
| Tenant isolation | Session-derived route guards plus scoped database conditions |
| Error monitoring | Sentry `@sentry/nextjs` + React Error Boundaries |
| UI animations | Framer Motion · `motion.div` + `AnimatePresence` + spring transitions |
| Toasts | Sonner |
| Command palette | `cmdk` · `⌘K` keyboard shortcut |
| Styling | Tailwind CSS v4 |

---

## Project Structure

```text
src/
  app/
    page.tsx                         Landing / sign-in / sign-up
    (app)/
      layout.tsx                     Sidebar, toaster, command palette, app footer
      dashboard/page.tsx             Procurement dashboard
      procurement/page.tsx           New procurement workflow (6-step)
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
      inngest/route.ts               Inngest serve handler (GET/POST/PUT)
      parse-menu/route.ts            Dish + hidden ingredient extraction
      pricing/route.ts               Live market pricing (futures + BLS)
      ml/forecast/route.ts           OLS forecast + anomaly detection
      distributors/route.ts          Supplier search
      send-rfp/route.ts              RFP email dispatch
      simulate-conversation/route.ts Quote simulation
      recommend/route.ts             AI recommendation + RAG context
      agent/negotiate/route.ts       LangGraph 5-node negotiation pipeline (SSE)
  inngest/
    client.ts                        Inngest client (id: 'autorfp')
    functions.ts                     Background functions (pricing, rfp, archive)
  lib/
    auth.ts                          NextAuth options
    tenant.ts                        Tenant types + browser fallback helpers
    tenant-context.ts                AsyncLocalStorage for row-level tenant scope
    llm.ts                           Ollama/Groq chat helpers + model fallback chain
    prisma.ts                        Prisma client with $extends RLS interceptor
    embeddings.ts                    Ollama/fallback embeddings
    chroma.ts                        ChromaDB RAG memory client
    toast.ts                         Sonner toast helpers
  components/
    CommandPalette.tsx               cmdk palette (⌘K) with nav + actions
    ErrorBoundary.tsx                React class error boundary + Sentry capture
    Skeleton.tsx                     Loading skeletons
    ToastViewport.tsx                Legacy no-op (replaced by Sonner)

prisma/schema.prisma                 Prisma schema (tenantId indexes on all scoped models)
instrumentation.ts                   Next.js App Router Sentry server init hook
sentry.client.config.ts             Sentry browser config
sentry.server.config.ts             Sentry server config
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
| `AUTORFP_ENABLE_LEGACY_DEMO` | No | Keep `false`. Enables quarantined server routes only in non-production environments. |
| `NEXT_PUBLIC_AUTORFP_ENABLE_LEGACY_DEMO` | No | Keep `false`. Shows quarantined client controls only in a non-production legacy demo. |
| `GROQ_API_KEY` | No | Optional legacy demo integration. Not used by the production-safe default. |
| `GOOGLE_MAPS_API_KEY` | No | Optional legacy demo supplier-search integration. |
| `RESEND_API_KEY` | No | Optional legacy demo email integration. It is not proof of delivery. |
| `MOCK_EMAIL` | No | Optional legacy demo routing address. |
| `AUTORFP_SEND_BUYER_REPORT` | No | Legacy demo switch. Leave disabled. |
| `BUYER_EMAIL` | No | Legacy demo report recipient. |
| `CHROMA_URL` | No | Optional legacy demo vector-store URL. |
| `OLLAMA_URL` | No | Optional local model URL. The safe default does not require it. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Sentry DSN. Error tracking is disabled when unset. |
| `INNGEST_EVENT_KEY` | No | Legacy background-job development only. |
| `INNGEST_SIGNING_KEY` | No | Legacy background-job development only. |

### 3. Initialize the database

```bash
npx prisma generate
npx prisma db push
```

### 4. Optional: local AI services

Ollama for local/private inference (confirmed working with `llama3.2` + `nomic-embed-text`):
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

## Safe Local Workflow

Start the app with the legacy flags left at `false`, create a restaurant workspace, and use pasted menu text. The flow will stop after it creates the demand draft. Demo seeding and external-action workflows are intentionally unavailable in this mode.

### Sample menus to try

Paste this text into New Procurement:
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

## Current and Legacy Runtime Behavior

| Capability | Current default | Legacy demo only |
|---|---|---|
| Menu parsing | Deterministic bounded-text draft | Explicitly enabled local or external model experiments |
| Negotiation | Disabled | LangGraph and model fallbacks |
| Embeddings and memory | Disabled | Optional Ollama and ChromaDB experiments |
| Background jobs | Disabled | Inngest function experiments |
| Error tracking | React error boundaries | Optional Sentry integration |

The current default does not depend on paid AI, supplier search, email, or background-job APIs.

---

## Quarantined Architecture Notes

This section documents legacy implementation code that remains in the repository for replacement work. It does not describe enabled production behavior.

### LangGraph Negotiation Pipeline

The `GET /api/agent/negotiate` route compiles a `StateGraph` at module load time:

```
loadData → orchestrate → analyze → negotiate → finalize → END
```

Each node returns a partial state update. The legacy `negotiate` node can emit SSE events through a request-scoped callback map. The route and client controls are disabled by default.

`loadDataNode` contains `menuId` and `tenantId` filters. Production safety relies on authenticated route-derived tenant context and scoped database operations, and the remaining legacy graph still requires a final isolation audit before any release.

### Parallel Quote Simulation

`handleAutoConversation` contains a parallel simulation experiment using `Promise.all`. Simulated vendor messages are test data, not supplier responses. The handler is gated off by default.

### Tenant Isolation

`src/lib/prisma.ts` includes a Prisma extension that injects tenant fields for selected models and operations. Internal routes now derive tenant context from authenticated sessions, and sensitive quote writes use transactional tenant conditions. A complete tenant matrix and adversarial verification remain required before launch.

### Inngest

Three background function definitions are registered at `GET|POST|PUT /api/inngest` for legacy development. The route fails closed unless legacy demo mode is explicitly enabled outside production. Production job semantics are not yet approved.

---

## License

MIT
