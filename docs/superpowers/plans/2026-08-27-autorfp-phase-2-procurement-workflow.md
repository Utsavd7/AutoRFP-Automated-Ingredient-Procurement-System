# AutoRFP Phase 2 Deterministic Procurement Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the real non-AI journey from reviewed menu and demand through immutable RFP, supplier quote, deterministic comparison, approved award, and purchase-order export.

**Architecture:** Small pure domain functions own units, demand, money, quote totals, state transitions, and savings. Route handlers validate input, authorize one fixed action, and call one organization-scoped transaction. Issued RFPs and submitted quotes are immutable versions. Suppliers exchange a fragment-held invitation token for an HttpOnly scoped cookie, then use public supplier APIs protected by invitation scope, expiry, revocation, rate limits, and optimistic version checks.

**Tech Stack:** TypeScript, PostgreSQL/Prisma, Zod, `decimal.js`, `pdf-lib`, Jest, fast-check, Playwright.

---

## Simplicity boundary

Support pasted text and CSV first; text PDF import is one bounded adapter and scanned-image OCR is explicitly unsupported. Support INR and three base dimensions (`g`, `ml`, `ea`). No catalog marketplace, bidding chat, autonomous negotiation, dynamic workflow builder, or generic rules engine. UI sorting is deterministic and visible; there is no AI winner.

## File map

Create domain modules under `src/domain/procurement/`:

- `money.ts`, `units.ts`, `demand.ts`, `rfp-state.ts`, `quote-state.ts`
- `quote-calculation.ts`, `freight-allocation.ts`, `comparison.ts`, `savings.ts`
- `invitation-token.ts`, `schemas.ts`

Create services under `src/services/procurement/`:

- `import-menu.ts`, `create-demand-run.ts`, `create-rfp.ts`, `transition-rfp.ts`
- `create-invitations.ts`, `submit-quote.ts`, `compare-quotes.ts`
- `create-award.ts`, `create-purchase-order.ts`, `export-purchase-order.ts`

Create bounded UI under `src/components/procurement/` and routes under `src/app/api/menus`, `demand-runs`, `rfps`, `supplier`, `awards`, and `purchase-orders`. Replace the old 2,000-line procurement page when the journey is complete.

## Task 1: Establish authoritative money and unit primitives

- [ ] Install `decimal.js`, `fast-check`, `pdf-lib`, `@playwright/test`, and the smallest CSV/text-PDF parser whose license is approved; record each in `docs/licenses/runtime-dependencies.md`.
- [ ] Write failing unit and property tests for integer paise, half-up GST rounding, overflow rejection, exact kg→g and litre→ml conversion, dimension mismatch, and prohibited mass↔volume conversion.
- [ ] Implement `MoneyPaise` as a branded safe integer and use `Decimal` only at calculation boundaries. Never persist or return authoritative money as JavaScript `number` rupees.
- [ ] Implement a closed unit map for `g`, `kg`, `ml`, `l`, `ea`, and common spelling aliases. Conversion returns value, rule name, and rule version.
- [ ] Run `npm test -- --runTestsByPath __tests__/domain/money.test.ts __tests__/domain/units.test.ts`.

Expected: all examples and properties PASS.

- [ ] Commit with `git commit -m "feat: add INR money and canonical unit primitives"`.

## Task 2: Add the versioned procurement schema

- [ ] Add the specification's catalog/demand/procurement tables to `prisma/schema.prisma`: canonical ingredients, menus/items/recipe ingredients, demand runs/lines, suppliers/contacts, RFPs/versions/lines/invitations, quotes/versions/lines, awards/lines, and purchase orders.
- [ ] Use `BigInt` paise columns, `Decimal @db.Decimal(18, 6)` quantities, explicit enums, non-null `organizationId`, integer `version`, and unique keys for idempotent mutations.
- [ ] Add `rawTokenHmac` unique on invitations; never add a raw-token column. Add expiry, revocation, permission, failed-attempt, and cooldown fields.
- [ ] Add `RateLimitBucket` only for supplier/public/auth limits. Do not introduce Redis.
- [ ] Generate `prisma migrate dev --name deterministic_procurement --create-only`, review SQL, add forced RLS to every new tenant table, and apply it in integration tests.
- [ ] Extend the RLS CRUD matrix to all new tables before adding route behavior.
- [ ] Run the integration RLS suite. Expected: PASS with zero table omissions.
- [ ] Commit with `git commit -m "feat: add versioned procurement data model"`.

## Task 3: Implement honest menu import and review

- [ ] Define Zod schemas for pasted text, CSV rows, and text-PDF results. Limits: 10 MB, 100 PDF pages, 250 menu items, 2,000 recipe lines, and bounded parse time.
- [ ] Write failing tests for valid pasted lines, quoted CSV fields, malformed CSV, oversized input, PDF without extractable text, duplicate item names, and unknown units.
- [ ] Implement deterministic extraction only for explicit names, quantities, and units. Unknown or ambiguous lines become review issues; nothing is invented.
- [ ] Add `POST /api/menus/import`, `GET /api/menus/[menuId]`, and `PUT /api/menus/[menuId]/review`. Require `manage_menu`, use organization transactions, version checks, audit, and idempotency.
- [ ] Build `MenuImportForm`, `MenuReviewTable`, and `ReviewIssueList`; keep all corrections user-editable.
- [ ] Add route tests for wrong role, cross-organization ID, stale version, invalid file, and successful reviewed menu.
- [ ] Commit with `git commit -m "feat: add deterministic menu import and review"`.

## Task 4: Calculate immutable demand snapshots

- [ ] Write failing tests for per-serving scaling, covers, date range, waste percentage, safety stock, fractional quantities, zero/negative rejection, and incompatible units.
- [ ] Implement one formula: `required = perServing × plannedServings × (1 + wasteBp/10000) × (1 + safetyStockBp/10000)`, rounded only to the ingredient base-unit precision.
- [ ] Store all inputs, conversion records, formula version, and output lines in immutable `DemandRun`/`DemandLine` rows.
- [ ] Add `POST /api/demand-runs` and `GET /api/demand-runs/[id]`; never recompute old snapshots after recipe edits.
- [ ] Build `DemandAssumptionsForm` and `DemandReviewTable` with explicit source recipe and calculation display.
- [ ] Commit with `git commit -m "feat: create auditable demand snapshots"`.

## Task 5: Enforce the RFP state machine and immutable issued versions

- [ ] Write a table-driven test for every allowed and denied RFP transition from the approved state machine.
- [ ] Implement `canTransitionRfp(from, to)` as a closed switch, not a configurable engine.
- [ ] Add create-draft, approve, open, close, cancel, and amend services. Each mutation checks row version, writes audit/outbox, and uses an idempotency key.
- [ ] Opening must copy reviewed demand lines and terms into immutable `RfpVersion`/`RfpLine` rows. Editing an open RFP is impossible; amendment creates a linked draft and revokes old invitations when opened.
- [ ] Add `/api/rfps` and action routes under `/api/rfps/[rfpId]/...`; clients never submit a status field directly.
- [ ] Add integration tests for concurrent open, duplicate idempotency key, amendment, revocation, and requested quantities matching demand lines exactly.
- [ ] Commit with `git commit -m "feat: enforce immutable RFP lifecycle"`.

## Task 6: Create secure supplier invitations and public sessions

- [ ] Write token tests for 32 random bytes, URL-safe encoding, HMAC-SHA-256 lookup, distinct tokens, expiry, revocation, replacement, and redacted logging.
- [ ] Implement token generation with Node `crypto.randomBytes(32)` and HMAC using `SUPPLIER_INVITATION_HMAC_SECRET`. Return raw tokens once; persist only HMAC.
- [ ] Generate links as `/quote#<raw-token>` so the token is not sent in the initial request or referrer.
- [ ] Add `POST /api/supplier/session`: accept the raw token in a bounded JSON body, apply database-backed token/IP limits, resolve invitation through the narrow database function, and set a `Secure`, `HttpOnly`, `SameSite=Strict`, path-scoped cookie containing the raw token. Clear the URL fragment in the browser immediately.
- [ ] Add supplier middleware/helpers that HMAC the cookie, resolve active scope, and open an RLS organization transaction. Do not create supplier accounts.
- [ ] Add tests for malformed, expired, revoked, cooled-down, and cross-RFP use; assert response timing/message does not reveal RFP existence.
- [ ] Commit with `git commit -m "feat: add scoped supplier invitation sessions"`.

## Task 7: Implement versioned supplier quote submission

- [ ] Write quote-state and validation tests for draft, submit, revise-before-deadline, withdraw, expiry, stale version 409, missing terms, MOQ, availability, and substitutions.
- [ ] Implement authoritative line calculation:

```text
packs = ceiling(requested_base_quantity / pack_base_quantity)
pre_tax = packs × price_per_pack_paise
taxable = pre_tax - one allowed discount
gst = round_half_up(taxable × gst_basis_points / 10000)
landed = taxable + gst + allocated_freight
```

- [ ] Write property tests proving non-negative totals, exact sum of rounded lines, and final-line freight/discount remainder absorption.
- [ ] Add supplier APIs for safe RFP read, quote draft save, submit, revise, and receipt. Require invitation scope, deadline, version, idempotency, and public rate limits.
- [ ] Build the supplier form with INR, pack size/count, price/pack, GST, freight, discount, MOQ, available quantity, delivery, validity, substitutions, and visible calculated totals.
- [ ] Add CSP/noindex/no-referrer metadata and verify no third-party network request occurs.
- [ ] Delete the old `/api/quote/[rfpId]`, email simulator, and quote-simulation route when tests pass.
- [ ] Commit with `git commit -m "feat: accept real versioned supplier quotes"`.

## Task 8: Compare quotes with visible deterministic rules

- [ ] Write tests for compatible-line normalization, missing coverage, delivery miss, expiry, substitution, freight/GST inclusion, tie ordering, and incompatible units.
- [ ] Implement comparison output containing landed total, covered-line count, missing terms, delivery fit, validity, and explicit sort keys. Default sort is landed total among complete comparable quotes; incomplete quotes remain visible and flagged.
- [ ] Implement savings baseline precedence: latest comparable paid landed cost, else median valid current quotes, else unavailable. Never sum mutually exclusive hypothetical savings.
- [ ] Add comparison API and `QuoteComparisonTable`; let users choose a documented sort without hidden weighting.
- [ ] Remove recommendation and risk-score routes/components once deterministic comparison tests pass.
- [ ] Commit with `git commit -m "feat: add transparent quote comparison and savings baselines"`.

## Task 9: Implement explicit awards and purchase orders

- [ ] Write tests for full award, split award, over-allocation, recorded overage reason, wrong role, stale quote, and totals matching awarded lines.
- [ ] Implement award creation requiring Owner or Procurement Manager plus a rationale. It may split lines but cannot silently exceed requested quantity.
- [ ] Create purchase-order records only from committed awards. Copy supplier, location, line, commercial, tax, and delivery facts into an immutable snapshot.
- [ ] Add CSV export using a small local formatter and PDF export with `pdf-lib`; test values and totals, not pixel layout.
- [ ] Add award and purchase-order routes/components and audit every decision/export.
- [ ] Delete legacy negotiation and fabricated procurement-history calculation code after equivalent real records drive dashboard/history.
- [ ] Commit with `git commit -m "feat: add auditable awards and purchase orders"`.

## Task 10: Replace the monolithic procurement page

- [ ] Add a thin server page loading the current workflow IDs; keep client state local to each bounded form/table.
- [ ] Compose existing bounded components into `Menu → Demand → RFP → Quotes → Award → Purchase Order` navigation with server-owned status.
- [ ] Remove the old 2,000-line page, localStorage workflow state, timers, fake email threads, agent events, simulated progress, dollar copy, and legacy feature flags.
- [ ] Keep plain language. Do not add model names, agent avatars, synthetic confidence, glowing dashboards, or generated executive filler.
- [ ] Add component tests for permission-disabled actions and safe empty/error states.
- [ ] Commit with `git commit -m "refactor: replace demo pipeline with bounded procurement workflow"`.

## Task 11: Prove the non-AI journey for two organizations

- [ ] Configure Playwright with one desktop browser project and deterministic test data. Avoid a browser/device matrix until pilot evidence requires it.
- [ ] Write the complete journey for Organization A: activate owner, configure location, import/review menu, create demand, open RFP, exchange supplier token, submit/revise quote, compare, split award, and export PO.
- [ ] In the same suite, create Organization B and assert it cannot observe A through pages, APIs, counts, IDs, exports, or supplier tokens.
- [ ] Add concurrent quote revision and idempotent submit tests.
- [ ] Stop any local model process and rerun the journey.

Expected: complete journey PASS unchanged.

- [ ] Run `npm test`, `npm run test:e2e`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Commit with `git commit -m "test: verify deterministic procurement journey"`.

## Phase 2 exit gate

- [ ] Two isolated organizations complete the entire journey with the model stopped.
- [ ] Issued RFP and submitted quote versions are immutable and concurrent edits return 409.
- [ ] Supplier tokens are scoped, expiring, revocable, rate-limited, absent from storage/logs/referrers, and cannot cross RFPs.
- [ ] All unit, money, GST, freight, MOQ, pack, savings, award, and export tests pass.
- [ ] No simulated supplier, quote, sending, negotiation, recommendation, or savings code remains.
