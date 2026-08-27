# India-First Launch Product and Website Design

**Status:** Approved for implementation

**Date:** 2026-08-27

**Launch target:** A real hosted procurement product for 1-10 Indian restaurant organizations, validated for 20 or more without an application rewrite

**Supersedes:** The OCI, Better Auth, local-AI, worker, and multi-service direction in `2026-08-27-india-first-zero-cost-production-design.md` and its phase plans

## 1. Product decision

Build one focused restaurant ingredient procurement product. A restaurant team reviews menu demand, maintains its supplier directory, creates a procurement request, shares secure supplier-specific links, receives itemized quotes, compares facts, records a human award, and retains factual history.

The launch product will not use paid APIs. It will also not add local AI, queues, Redis, a vector database, microservices, autonomous negotiation, automatic supplier discovery, automatic awards, or simulated savings. These are not needed for the first real customers.

The working company and product identity is provisional. The name and mark will be isolated in reusable brand components so they can be refined without blocking product delivery or requiring a page rewrite.

## 2. Launch experience

### Public website

The website is a real full-viewport marketing surface, not a concept board or a browser mockup.

Routes:

- `/`: public company landing page
- `/product`: guided public product tour using clearly labeled sample records
- `/signin`: existing-user sign in
- `/start`: restaurant owner workspace creation for the controlled pilot
- `/quote/[token]`: focused supplier quote portal reached through a secure link

The landing page contains:

1. A compact navigation with Product, How it works, Security, Sign in, See the product, and Start a pilot.
2. A two-line value proposition focused on accountable ingredient procurement.
3. A real product preview implemented from the same quote-comparison component used by the product. Sample data is visibly labeled.
4. A factual proof band: INR and GST inputs, secure supplier links, no supplier account requirement, and human awards.
5. A short end-to-end workflow explaining the restaurant and supplier journeys.
6. A security section that explains tenant isolation, expiring links, and audit history in plain language.
7. A final pilot call to action and a small legal footer.

The public site will not claim market pricing, percentage savings, customer counts, automatic negotiation, artificial intelligence, or integrations that do not exist.

### Authenticated product

The authenticated product keeps a calm, high-density operational interface. It uses the same identity tokens as the public site but does not use editorial marketing layouts inside daily workflows.

Primary navigation:

- Overview
- Procurement
- Suppliers
- Menus
- Insights
- History
- Settings

The dashboard shows real current work only: requests needing attention, quote deadlines, quotes ready for review, and recent awards. It does not show fabricated trends or predictions.

### Supplier portal

The supplier portal is mobile-first and does not require an account. It shows only the request connected to its secure token. Suppliers can enter item availability, unit rate, GST, freight, delivery date, validity, commercial terms, and notes. Totals are computed by the server and shown before submission.

## 3. Visual system

The visual direction is a restrained enterprise editorial system for the public site and a pragmatic operations system for the product.

Core colors:

- Ink: `#101817`
- Raised ink: `#172521`
- Stone: `#F5F1E8`
- Soft stone: `#EBE5D9`
- Copper accent: `#D8834F`
- Semantic success green: `#285E4D`

Copper is the single brand accent. Green is used only for real success or valid-status semantics.

Typography:

- Self-hosted open-source sans-serif for navigation, body text, controls, and product UI.
- Self-hosted open-source editorial serif for public display headings only.
- Tabular numerals for prices, quantities, and dates.

Shape rules:

- Controls: 8 px radius.
- Product panels: 12 px radius.
- Large marketing media: 16 px radius.
- Pills only for compact status or filter controls.

Motion is limited to 140-220 ms interaction feedback, restrained entry transitions, and genuine state changes. It animates transform and opacity only and respects `prefers-reduced-motion`. The product does not use scroll hijacking, decorative cursor animation, perpetual card movement, or Apple imitation effects.

## 4. Working logo direction

The current speech-bubble sketch will not be used as the production mark.

The provisional direction is a reduced **request-to-quote ledger mark**:

- Two offset rectangular forms represent a request and a supplier quote.
- Their shared negative space forms a clear forward path toward an award.
- The mark must remain readable at 20 px in the product sidebar and at 32 px in the public navigation.
- A one-color version must work in ink, stone, and copper.
- The wordmark uses the product sans-serif with customized spacing, not a decorative startup font.

The mark is intentionally kept in one isolated component and asset set. Final naming, India trademark clearance, domain checks, and final logo refinement can happen without blocking the procurement implementation.

## 5. Production architecture

Use one Next.js 16 application and one PostgreSQL database.

Deployment:

- Google Cloud Run in `asia-south1`, request-based billing, min 0, max 2, concurrency 20.
- Supabase Postgres Free in `ap-south-1` for the controlled pilot.
- Vercel remains a preview environment only.

This is a near-zero-cost launch target, not a promise of a permanent zero bill. Cloud billing must be enabled, cross-cloud egress can cost money, Supabase Free can pause, and independent backups may have a small storage cost.

### 5.1 Free-first operating limits

The pilot starts inside free allocations and upgrades only after real usage reaches a documented trigger:

- Cloud Run uses request-based billing, 512 MiB memory, min 0, max 2, concurrency 20, and no always-on worker.
- Supabase Free is limited to a 500 MB database. Files, PDFs, QR codes, raw imports, and exports are not stored in PostgreSQL.
- Database warnings trigger at 350 MB and 425 MB. New tenant onboarding pauses at 450 MB until the operator chooses an upgrade or archives eligible raw input.
- Encrypted `pg_dump` backups use Cloudflare R2 Standard with a 30-day rolling retention and four monthly restore points. The job fails closed before projected storage exceeds 8 GB of the 10 GB monthly free allocation.
- Artifact Registry retains only the two newest deployable images and must remain below its free storage allowance.
- GitHub Actions runs required checks on pull requests and protected-branch pushes, cancels superseded runs, and avoids scheduled duplicate test runs.
- Cloud budget alerts are warnings, not hard spending caps. The service configuration itself provides the primary guard through min 0, max 2, small memory, bounded request size, and no background compute.
- No infrastructure plan automatically upgrades a paid tier. Scaling requires an explicit operator decision documented in the cost-boundary runbook.

Upgrade triggers are product evidence, not calendar dates: sustained database size above 70%, pool saturation, p95 authenticated latency above 800 ms at normal query load, backup size beyond the safe retention envelope, or repeated Cloud Run usage beyond its free allowance.

Application boundaries:

- Next.js Server Components for public and authenticated page composition.
- Small Client Components only where interaction or motion requires them.
- Route handlers for authenticated APIs and public supplier quote submission.
- Prisma for schema and queries.
- Short explicit tenant-scoped database transactions.
- No worker, message queue, cron-dependent application behavior, or secondary service at launch.

## 6. Identity and tenant boundary

Keep NextAuth Credentials for launch.

Add a real `User` model. Every user belongs to one `Tenant` and has one of two roles:

- `OWNER`
- `MEMBER`

New passwords use Argon2id. Existing SHA-256 credentials are verified only for migration and are immediately upgraded after a successful sign in.

Every protected request reloads the active user, tenant, status, and role from PostgreSQL. JWT contents are display hints, not current authorization.

Tenant-owned tables have a direct non-null `tenantId`. PostgreSQL row-level security is enabled and forced. The application runtime uses a restricted `NOBYPASSRLS` role. Every tenant transaction sets a transaction-local tenant identifier before accessing tenant data.

Owner-only actions are limited to workspace settings, member management, and final award approval. The last active owner cannot be deactivated.

## 7. Core data model

Preserve and extend `Menu`, `Recipe`, and `Ingredient`.

Add the real production core:

- `User`
- `Invitation`
- `Supplier`
- `ProcurementRequest`
- `RequestItem`
- `SupplierRequest`
- `SupplierQuote`
- `SupplierQuoteItem`
- `Award`
- `AwardLine`
- `AuditEvent`
- `RateLimitBucket`

Authoritative money is stored as integer paise. GST rates use basis points. Quantities use decimal values with an explicit unit. Launch units are deliberately small and practical: kilogram, gram, litre, millilitre, piece, pack, case, and crate.

An opened procurement request copies reviewed ingredients into immutable request items. Later menu edits do not change an issued request.

### 7.1 Minimum-schema rule

The database contains only fields used by the launch workflow, a security policy, or a required audit record. It does not reserve columns for possible future features.

Specifically:

- Remove legacy savings targets, simulated savings, predicted spend, market alerts, AI summaries, agent state, pricing trends, and preferred-supplier text fields from production authority.
- Do not add analytics, forecast, vector, embedding, job, email-delivery, purchase-order, inventory, or government-price tables at launch.
- Compute dashboard counts and comparison views from transactional records instead of storing duplicate reporting rows.
- Keep `tenantId` directly on tenant-owned tables even when it is relationally redundant because forced RLS depends on it.
- Keep immutable request and quote snapshots because issued commercial records must not change when a menu or supplier record changes.
- Store flexible address and commercial-term details as small validated JSON objects only when they are not filtered, joined, or sorted. Keep identifiers, money, dates, status, role, and foreign keys as typed columns.
- Create indexes only for tenant-scoped list pages, unique identities, public-token lookup, request deadlines, and foreign keys.
- Paginate history and supplier/request lists. Never load unbounded rows into the application.
- Expire rate-limit buckets automatically and keep audit metadata compact and allow-listed.
- Retain raw menu input for at most 30 days after review unless it is still attached to a draft.

The goal is minimum stored data and minimum query work, not the fewest possible table names. Separate request items, quote items, award lines, and token grants remain justified because combining them would weaken validation, isolation, or auditability.

## 8. Complete product workflow

### Restaurant setup

1. An owner creates a workspace with restaurant name, Indian address, city, state, PIN, phone, timezone, and GSTIN when applicable.
2. The owner can invite members using one-time links. No email API is required; the link can be copied and shared manually.

### Menu and ingredient review

1. A user pastes a menu or creates dishes manually.
2. Existing deterministic parsing can create a draft, but it cannot present uncertain ingredients as reviewed fact.
3. A user reviews dish names, ingredients, quantities, units, and expected demand.
4. The menu is explicitly approved. Editing an approved menu returns it to draft.

### Supplier directory

1. Users create tenant-owned supplier records.
2. Records support contact name, business name, phone, WhatsApp number, email, address, city, state, PIN, GSTIN, notes, and active status.
3. No supplier is presented as verified unless the restaurant has recorded verification.

### Procurement request

1. A user selects reviewed demand, delivery details, deadline, terms, and suppliers.
2. Opening the request creates immutable request-item snapshots.
3. The server creates one high-entropy supplier token per supplier and stores only a domain-separated token digest.
4. The restaurant shares links through Copy, Web Share, WhatsApp deep link, locally generated QR code, or its own email client.

### Supplier quote

1. A supplier opens the secure link without an account.
2. The portal enforces expiry, revocation, request status, and rate limits.
3. Each item supports available quantity, unit, unit price, GST, substitution, and no-quote status.
4. The quote supports freight, delivery date, validity, MOQ or terms, and notes.
5. The server calculates subtotal, GST, freight, and total.
6. Revisions create immutable versions rather than overwriting prior submissions.

### Comparison and award

1. Comparison is deterministic and displays total landed cost, item coverage, delivery, validity, substitutions, and commercial terms.
2. The product does not hide a scoring formula or recommend a winner with AI.
3. An owner can award the whole request to one quote or select winning quote items per request item.
4. The server validates that awarded quantities do not exceed requested quantities and that every selected quote item belongs to the request.
5. Award lines, the award envelope, and its audit event commit atomically.
6. A purchase-order PDF can be generated on demand per awarded supplier from the committed award. It does not require a purchase-order table.

### History and insights

History shows issued requests, quote revisions, awards, and audit events. Insights use only actual quotes and awards. A `Run again` action duplicates a past request into a new draft; it never mutates the historical record.

### Original capability preservation

The original demonstration's useful product ideas remain, but simulated claims are replaced by real or manual behavior:

| Original capability | Launch implementation |
|---|---|
| Menu parsing | Deterministic draft extraction followed by explicit dish, ingredient, quantity, and unit review |
| Supplier discovery | Searchable tenant supplier directory with manual entry and CSV import |
| Supplier outreach | Copy, Web Share, WhatsApp deep link, and prefilled email composer using secure supplier links |
| Negotiation agent | Human-reviewed counter-offer text, copy/share actions, and immutable supplier quote revisions |
| Conversation simulation | Factual request activity and revision history; no invented messages |
| Market pricing | Unit-price history computed from the restaurant's actual submitted quotes and awards |
| Forecasting | Repeat-request creation and historical quantity views; no invented demand forecast |
| Savings dashboard | Transparent comparison between real submitted quotes, labeled as quote variance rather than realized savings |
| Intelligence page | Actual quote coverage, awarded spend, supplier response, delivery terms, and item-price history |
| RFP history | Immutable request, supplier-link, quote-revision, award, and audit history |

These equivalents keep the product's functional breadth without depending on AI, scraped supplier data, paid communications, or fabricated evidence.

Zero-cost operational utilities are included where they improve the real workflow without adding a hosted service:

- CSV supplier import with row-level validation and an error report.
- CSV exports for requests, quotes, awards, and accounting handoff.
- Locally generated QR codes for supplier links.
- On-demand purchase-order PDFs generated from committed award data.
- Whole-request and line-level split awards.

## 9. Safety and public-link rules

- Public tokens contain at least 256 bits of randomness.
- Raw tokens are never persisted or logged.
- Public quote pages use `noindex`, `no-referrer`, a restrictive content security policy, and same-origin form submissions.
- Rate limiting is stored in PostgreSQL so it works across Cloud Run instances.
- Public and authenticated writes use schema validation and explicit server totals.
- Audit metadata excludes passwords, tokens, quote bodies, and unnecessary contact data.
- Production logs never include database URLs, authorization headers, cookies, or supplier token paths.

## 10. States and accessibility

Every production screen includes:

- A layout-matching loading state.
- A useful empty state with one clear next action.
- Inline form validation and recoverable errors.
- A disabled state for invalid or already-completed actions.
- A confirmation step for opening a request, revoking a link, and awarding a quote.

All navigation and forms are keyboard usable. Focus is visible. Body text and controls meet WCAG AA contrast. Touch targets are at least 44 px on supplier-facing mobile screens. Motion can be disabled through the operating system preference.

## 11. Testing strategy

Implementation is test-driven.

Required layers:

1. Unit tests for password migration, token hashing, money totals, GST, quantities, request state, comparison, and award rules.
2. API tests for signup, tenant revalidation, owner guards, supplier CRUD, menu approval, request opening, public quote revision, comparison, and award.
3. Real PostgreSQL integration tests for migrations, forced RLS, cross-tenant CRUD, public token isolation, quote submission races, and atomic awards.
4. Browser tests for the public site, start and sign-in flows, one complete restaurant workflow, and the mobile supplier quote portal.
5. Build, lint, TypeScript, dependency, license, and secret checks in continuous integration.

No tenant-isolation claim is accepted based only on mocks or source-text assertions.

## 12. Operations and launch readiness

The repository will include:

- A multi-stage production `Dockerfile`.
- Cloud Run service configuration.
- Environment validation at startup.
- Liveness and readiness routes.
- CI and controlled deployment workflows.
- Daily encrypted PostgreSQL backup instructions and automation.
- A restore-verification script and monthly restore procedure.
- Canary checks for the public site, sign in, health, and protected routes.
- Incident, deployment, backup, cost-boundary, and rollback documentation.

The launch gate requires:

- All automated tests, lint, typecheck, and production build passing.
- A clean migration applied to a disposable PostgreSQL database.
- Forced RLS proven with two tenants.
- A successful complete procurement journey.
- A successful encrypted backup restoration.
- A passing 20-organization load profile.
- No production dependency on a paid API.
- GitHub branch pushed and preview deployment green.
- The root README rewritten to match the final product, architecture, local setup, deployment, security boundary, testing, and honest cost constraints.

## 13. Explicitly deferred

The following are deferred until real pilot evidence justifies them:

- Automated email or WhatsApp Business sending.
- Inventory receiving and invoice reconciliation.
- Full accounting integrations. CSV accounting exports are included.
- External government or commercial price feeds. Actual quote and award price history is included.
- External supplier discovery. The real tenant supplier directory, search, and CSV import are included.
- AI parsing, assistants, agents, forecasting, negotiation, or recommendations.
- Configurable roles and permissions.
- Multi-location organizations.
- Additional currencies and tax systems.

Deferring these items preserves a complete launch product while preventing infrastructure and interface work that the first 1-10 customers do not need.

## 14. India competitor response

The launch scope reflects a current review of restaurant procurement and adjacent sourcing products in India.

- Petpooja Purchase Manager is the closest small-restaurant alternative. It can compare Hyperpure and DMart prices with uploaded local supplier rate cards, but it is available only to active Petpooja POSS customers and uploaded local prices can become stale.
- Workwise Hospitality, Procol, QuickProc, ERPNext, and Odoo cover broader sourcing or procure-to-pay workflows. Their strength is breadth; their trade-off for this launch segment is setup, supplier accounts or apps, and enterprise process weight.
- Restroworks and SupplyNote connect procurement with inventory and multi-location restaurant operations. Those capabilities become relevant later, after customers prove a need for receiving, stock, and invoice reconciliation.
- Hyperpure, horeca360 by udaan, Udaan, Amazon Business, METRO, and Procura India are catalogues or marketplaces. They are possible suppliers or reference channels, not neutral multi-supplier comparison systems.

The product therefore competes on a narrower and defensible workflow:

1. It is standalone and does not require the restaurant to replace its POS.
2. It works with the restaurant's own supplier relationships rather than forcing marketplace fulfilment.
3. Suppliers respond through a secure mobile link without an account or app.
4. Comparison normalizes availability, units, GST, freight, delivery, validity, and missing items instead of comparing an uploaded headline rate alone.
5. A restaurant can award one complete basket or split lines across suppliers, then generate an auditable PO.

The product will not copy reverse auctions, inventory depletion, GRN, payments, credit, logistics, contracts, marketplace discovery, or enterprise approval builders merely because competitors offer them. Those are separate products or later stages of the purchasing lifecycle and would weaken the launch workflow.
