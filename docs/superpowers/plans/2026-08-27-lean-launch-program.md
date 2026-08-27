# Lean Launch Product Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship a hosted, India-first restaurant ingredient procurement product that a real 1-10 organization pilot can use today and that can reach 20+ organizations without an application rewrite.

**Architecture:** One Next.js 16 application, PostgreSQL, Prisma, NextAuth Credentials, forced PostgreSQL RLS, and request-based Cloud Run. The product creates reviewed demand, sends supplier-specific no-login links, collects immutable quote revisions, compares landed cost, records whole or split awards, and generates exports on demand. No paid API, worker, queue, marketplace scraper, AI runtime, or stored generated file is part of launch.

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL, Prisma 5, NextAuth 4, `@node-rs/argon2`, Zod 4, `csv-parse`, `qrcode`, `@react-pdf/renderer`, Jest, Testcontainers, Playwright, axe-core, Docker, Cloud Run, Supabase Postgres Free, Cloudflare R2 backups.

**Authority:** `docs/superpowers/specs/2026-08-27-launch-product-experience-design.md` is the approved product and architecture specification. Earlier OCI, local-AI, worker, and simulated-product plans are superseded.

---

## Phase 1: Lean foundation, identity, and isolation

### Task 1: Establish the real PostgreSQL test and migration baseline

**Files:**
- Create: `jest.integration.config.cjs`
- Create: `__tests__/integration/setup/postgres.ts`
- Create: `__tests__/integration/migrations.test.ts`
- Create: `prisma/migrations/20260827000100_lean_baseline/migration.sql`
- Modify: `package.json`

**RED:** Add an integration test that starts disposable PostgreSQL, applies every migration to an empty database, and asserts the launch tables and restricted runtime role exist. Run `npm run test:integration -- migrations.test.ts`; expect failure because the harness and migration do not exist.

**GREEN:** Add `testcontainers`, a bounded test setup, `prisma migrate deploy`, and the baseline migration. The migration must be repeatable only through Prisma's migration table, create required extensions explicitly, and fail on schema drift.

**VERIFY:** Run `npm run test:integration -- migrations.test.ts`, `npm run typecheck`, and `npm run build`.

**COMMIT:** `test: add disposable postgres migration harness`

### Task 2: Replace the legacy authority with the minimum production schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260827000200_launch_schema/migration.sql`
- Create: `__tests__/integration/schema-shape.test.ts`

**RED:** Assert the schema contains only Tenant, User, Invitation, Menu, Recipe, Ingredient, Supplier, ProcurementRequest, RequestItem, SupplierRequest, SupplierQuote, SupplierQuoteItem, Award, AwardLine, AuditEvent, and RateLimitBucket, with direct non-null tenant identifiers on tenant-owned rows, integer paise, decimal quantities, and no legacy simulated analytics authority.

**GREEN:** Implement the minimal models and enums. Do not store selected supplier/ingredient ID arrays, generated PDFs, QR images, dashboard aggregates, forecast rows, scraped prices, emails, or job state. Use compact validated JSON only for non-queryable immutable snapshots and metadata. Add only list, foreign-key, identity, deadline, and token lookup indexes.

**VERIFY:** Run schema-shape integration test, `npx prisma validate`, `npx prisma generate`, and a clean migration deploy.

**COMMIT:** `feat: add minimal launch procurement schema`

### Task 3: Add real users, Argon2id migration, and current authorization

**Files:**
- Modify: `src/lib/password.ts`
- Modify: `src/lib/auth.ts`
- Modify: `src/types/next-auth.d.ts`
- Create: `src/lib/auth/current-user.ts`
- Create: `src/app/api/auth/start/route.ts`
- Create: `__tests__/auth/password.test.ts`
- Create: `__tests__/api/auth-start.test.ts`

**RED:** Test Argon2id hashes, legacy SHA-256 verification and immediate upgrade, unique lowercase email signup, inactive-user rejection, and a session whose JWT claims cannot preserve authorization after a database role/status change.

**GREEN:** Use `@node-rs/argon2`. Signup creates Tenant and OWNER User atomically. NextAuth sign-in authenticates User, upgrades a legacy hash after success, and stores only stable identifiers in JWT. Every protected request reloads current User and Tenant.

**VERIFY:** Run focused auth tests and build.

**COMMIT:** `feat: add production user identity and password migration`

### Task 4: Enforce tenant transactions and forced RLS

**Files:**
- Create: `src/lib/db/tenant-transaction.ts`
- Create: `src/lib/auth/guards.ts`
- Create: `src/lib/audit/write-event.ts`
- Create: `prisma/migrations/20260827000300_forced_rls/migration.sql`
- Create: `__tests__/integration/rls-isolation.test.ts`
- Create: `__tests__/integration/owner-guards.test.ts`

**RED:** Through the restricted runtime role, prove tenant A cannot select, insert, update, or delete tenant B data; prove unset tenant context sees no tenant rows; prove MEMBER cannot award or manage membership; prove the last active OWNER cannot be deactivated.

**GREEN:** Implement `withTenant(tenantId, callback)` as a short interactive transaction that calls `set_config('app.tenant_id', tenantId, true)`. Enable and force RLS on every tenant table, give `autorfp_app` no bypass, use owner guards for awards/settings/members, and write compact allow-listed audit records in the same transaction as protected mutations.

**VERIFY:** Run all RLS tests twice, including parallel tenant requests.

**COMMIT:** `security: enforce database tenant isolation`

### Task 5: Add one-time member invitations

**Files:**
- Create: `src/lib/security/tokens.ts`
- Create: `src/app/api/members/invitations/route.ts`
- Create: `src/app/api/invitations/[token]/accept/route.ts`
- Create: `src/app/(public)/join/[token]/page.tsx`
- Create: `__tests__/api/invitations.test.ts`

**RED:** Test 256-bit raw tokens, domain-separated digest storage, expiry, one-time acceptance, revocation, email matching, and last-owner protection.

**GREEN:** Store only token digests. Return a copyable invitation link once; do not send email. Accept in one transaction and make replay fail safely.

**VERIFY:** Run invitation API and integration tests.

**COMMIT:** `feat: add secure member invitations`

---

## Phase 2: Procurement domain and APIs

### Task 6: Implement exact India money, units, and validation primitives

**Files:**
- Create: `src/lib/domain/money.ts`
- Create: `src/lib/domain/quantity.ts`
- Create: `src/lib/domain/validation.ts`
- Create: `__tests__/domain/money.test.ts`
- Create: `__tests__/domain/quantity.test.ts`

**RED:** Cover paise parsing/formatting, GST inclusive/exclusive calculations, freight, half-up rounding, decimal quantities, compatible unit normalization, invalid cross-dimension units, overflow, negative values, and locale-safe INR display.

**GREEN:** Keep authoritative values integer/Decimal until presentation. Support kg, g, L, ml, piece, pack, case, and crate. Do not silently convert pack/case/crate without an explicit pack quantity.

**VERIFY:** Run domain tests and property-edge fixtures.

**COMMIT:** `feat: add exact procurement calculations`

### Task 7: Build reviewed menus and immutable demand snapshots

**Files:**
- Modify: `src/lib/menu/deterministic-draft.ts`
- Create: `src/lib/menu/menu-service.ts`
- Create: `src/app/api/menus/route.ts`
- Create: `src/app/api/menus/[id]/route.ts`
- Create: `src/app/api/menus/[id]/approve/route.ts`
- Create: `__tests__/api/menus.test.ts`

**RED:** Test manual creation, deterministic draft parsing, ingredient correction, explicit approval, edit returning an approved menu to draft, and cross-tenant denial. Test that later menu edits cannot mutate issued request items.

**GREEN:** Persist only reviewable dish/ingredient/quantity/unit facts. Bound pasted input and remove it after the retention window. Never label deterministic suggestions as verified before approval.

**VERIFY:** Run menu API and RLS tests.

**COMMIT:** `feat: add reviewed menu demand workflow`

### Task 8: Build the tenant supplier directory and bounded CSV import/export

**Files:**
- Create: `src/lib/suppliers/supplier-schema.ts`
- Create: `src/lib/suppliers/csv.ts`
- Create: `src/app/api/suppliers/route.ts`
- Create: `src/app/api/suppliers/[id]/route.ts`
- Create: `src/app/api/suppliers/import/route.ts`
- Create: `src/app/api/suppliers/export/route.ts`
- Create: `__tests__/api/suppliers.test.ts`
- Create: `__tests__/suppliers/csv.test.ts`

**RED:** Test CRUD/search/pagination, duplicate email/phone handling, active filtering, 1 MB/500-row CSV limits, row-level errors, CSV formula-injection escaping, and tenant isolation.

**GREEN:** Use `csv-parse/sync`; do not save source files. Import valid rows transactionally according to explicit all-or-nothing behavior and return a small error report.

**VERIFY:** Run supplier tests and import a representative Indian address/GSTIN fixture.

**COMMIT:** `feat: add supplier directory and csv exchange`

### Task 9: Create, open, and share procurement requests

**Files:**
- Create: `src/lib/procurement/request-service.ts`
- Create: `src/app/api/requests/route.ts`
- Create: `src/app/api/requests/[id]/route.ts`
- Create: `src/app/api/requests/[id]/open/route.ts`
- Create: `src/app/api/requests/[id]/links/route.ts`
- Create: `__tests__/api/requests.test.ts`

**RED:** Test drafts, approved-demand selection, supplier selection, delivery/deadline validation, immutable item copy, per-supplier unique token digests, one-time raw-link return, revoke/rotate behavior, and forbidden state transitions.

**GREEN:** Create SupplierRequest rows rather than ID arrays. Opening and link creation are atomic. Sharing is copy/Web Share/WhatsApp/mailto only; no hosted messaging API.

**VERIFY:** Run request API tests and token leakage scan.

**COMMIT:** `feat: add secure procurement request issuance`

### Task 10: Protect public supplier links with database rate limits

**Files:**
- Create: `src/lib/security/public-grant.ts`
- Create: `src/lib/security/rate-limit.ts`
- Create: `prisma/migrations/20260827000400_public_grants/migration.sql`
- Create: `__tests__/integration/public-token-isolation.test.ts`
- Create: `__tests__/integration/rate-limit.test.ts`

**RED:** Test invalid, expired, revoked, and cross-request tokens; parallel quota consumption; stale bucket cleanup; and raw-token absence from database/logs.

**GREEN:** Resolve only a digest through a narrowly scoped SECURITY DEFINER function or restricted transaction path. Consume bounded PostgreSQL rate-limit buckets atomically. Set public route noindex, no-referrer, restrictive CSP, and same-origin submission policy.

**VERIFY:** Run public security integration tests under concurrency.

**COMMIT:** `security: protect supplier quote links`

### Task 11: Collect immutable supplier quote revisions with server totals

**Files:**
- Create: `src/lib/quotes/quote-schema.ts`
- Create: `src/lib/quotes/quote-service.ts`
- Create: `src/app/api/public/quotes/[token]/route.ts`
- Create: `__tests__/api/public-quotes.test.ts`
- Create: `__tests__/integration/quote-races.test.ts`

**RED:** Test availability, no-quote, substitution, quantity/unit/rate/GST, freight, delivery, validity, terms, server total override, immutable revisions, stale request rejection, and simultaneous submissions.

**GREEN:** Recompute every total server-side. Write a new monotonically increasing revision and its items atomically; never update a submitted revision in place.

**VERIFY:** Run quote unit/API/race tests.

**COMMIT:** `feat: add immutable supplier quote revisions`

### Task 12: Compare facts and award whole or split baskets

**Files:**
- Create: `src/lib/comparison/compare-quotes.ts`
- Create: `src/lib/awards/award-service.ts`
- Create: `src/app/api/requests/[id]/comparison/route.ts`
- Create: `src/app/api/requests/[id]/award/route.ts`
- Create: `__tests__/comparison/compare-quotes.test.ts`
- Create: `__tests__/integration/awards.test.ts`

**RED:** Test full landed basket, unit normalization, missing items, substitutions, partial quantities, ties, incomplete quotes, whole award, split award, human override reason, duplicate award, over-award, foreign quote item, MEMBER denial, and rollback on any invalid line.

**GREEN:** Present deterministic facts, not a hidden recommendation. Owner award writes Award, AwardLine, required immutable supplier/delivery snapshots, request status, and AuditEvent in one transaction.

**VERIFY:** Run all comparison/award tests and prove a failed line creates no award rows.

**COMMIT:** `feat: add deterministic comparison and atomic awards`

### Task 13: Generate safe exports, QR codes, and purchase-order PDFs on demand

**Files:**
- Create: `src/lib/exports/csv.ts`
- Create: `src/lib/exports/purchase-order.tsx`
- Create: `src/app/api/requests/[id]/export/route.ts`
- Create: `src/app/api/requests/[id]/qr/route.ts`
- Create: `src/app/api/awards/[id]/purchase-orders/[supplierId]/route.ts`
- Create: `__tests__/exports/exports.test.ts`

**RED:** Test authorization, CSV injection escaping, deterministic filenames/content, QR encoding of only the intended link, A4 PDF signature/content, award snapshot stability after supplier edits, and no generated-file database rows.

**GREEN:** Generate bytes per request with strict size/time limits using `qrcode` and `@react-pdf/renderer`. Set private/no-store download headers.

**VERIFY:** Open representative PDF, decode representative QR, and run export tests.

**COMMIT:** `feat: add on-demand procurement exports`

---

## Phase 3: Professional website and complete product UI

### Task 14: Create the final brand system and public website

**Files:**
- Create: `src/config/brand.ts`
- Create: `src/components/brand/BrandMark.tsx`
- Create: `src/components/brand/Wordmark.tsx`
- Create: `src/components/public/*`
- Replace: `src/app/page.tsx`
- Create: `src/app/product/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `__tests__/ui/public-copy.test.tsx`

**RED:** Assert the home page renders without database or session access, uses one brand authority, has honest CTA/copy, labels sample data, exposes Product/How it works/Security/Sign in/Start, and contains none of the legacy autonomous-AI or fake-savings claims.

**GREEN:** Build the approved stone/ink/copper editorial site with accessible open-source self-hosted fonts, a crisp request-to-quote mark, real product component previews, restrained transform/opacity motion, responsive layouts, metadata, favicon, and reduced-motion support.

**VERIFY:** Production build with no DATABASE_URL, desktop/mobile browser screenshots, keyboard navigation, contrast, console, and network checks.

**COMMIT:** `feat: launch professional public website`

### Task 15: Separate and complete start, sign-in, and account flows

**Files:**
- Create: `src/app/signin/page.tsx`
- Create: `src/app/start/page.tsx`
- Create: `src/components/auth/AuthForm.tsx`
- Modify: `src/app/api/account/route.ts`
- Create: `__tests__/e2e/auth.spec.ts`

**RED:** Browser-test owner signup, duplicate email, wrong password, sign in, sign out, inactive account, redirect to intended protected page, and useful database-unavailable errors.

**GREEN:** Keep marketing page server-rendered and authentication in focused forms. Remove localStorage identity fallback and all client-authoritative tenant state.

**VERIFY:** Run auth E2E at mobile and desktop widths.

**COMMIT:** `feat: complete production account experience`

### Task 16: Build the authenticated operations shell and overview

**Files:**
- Replace: `src/app/(app)/layout.tsx`
- Replace: `src/app/(app)/dashboard/page.tsx`
- Create: `src/components/app/AppShell.tsx`
- Create: `src/components/app/StatusBadge.tsx`
- Create: `src/app/api/overview/route.ts`
- Create: `__tests__/e2e/navigation.spec.ts`

**RED:** Test authenticated server guard, responsive navigation, Overview/Procurement/Suppliers/Menus/Insights/History/Settings routes, keyboard/focus behavior, and real empty/loading/error states.

**GREEN:** Create a calm high-density workspace using real counts and current work only. Remove prototype pipeline, agent, fabricated metric, local tenant, and external-service labels.

**VERIFY:** Navigation E2E, axe scan, mobile sidebar, and no console errors.

**COMMIT:** `feat: add production operations workspace`

### Task 17: Build menu and supplier product screens

**Files:**
- Create: `src/app/(app)/menus/page.tsx`
- Create: `src/app/(app)/menus/[id]/page.tsx`
- Create: `src/app/(app)/suppliers/page.tsx`
- Create: `src/components/menus/*`
- Create: `src/components/suppliers/*`
- Create: `__tests__/e2e/menu-supplier.spec.ts`

**RED:** Test empty states, create/edit/review/approve menu, add/edit/deactivate/search supplier, CSV import errors, and mobile forms.

**GREEN:** Connect only to launch APIs with server-owned validation and explicit confirmation for approval/deactivation.

**VERIFY:** Complete menu/supplier E2E and axe scans.

**COMMIT:** `feat: add menu and supplier workspaces`

### Task 18: Build request creation, sharing, supplier response, and comparison UI

**Files:**
- Replace: `src/app/(app)/procurement/page.tsx`
- Create: `src/app/(app)/procurement/new/page.tsx`
- Create: `src/app/(app)/procurement/[id]/page.tsx`
- Replace: `src/app/quote/[rfpId]/page.tsx` with `src/app/quote/[token]/page.tsx`
- Create: `src/components/procurement/*`
- Create: `src/components/quotes/QuoteComparisonTable.tsx`
- Create: `src/components/quotes/SupplierQuoteForm.tsx`
- Create: `__tests__/e2e/procurement.spec.ts`

**RED:** Browser-test reviewed-demand selection, request opening confirmation, share options, token isolation, mobile quote entry, server total preview, revision, comparison, whole award, split award, PO/CSV download, and completed-state lockout.

**GREEN:** Use one `QuoteComparisonTable` for live and public sample contexts. Label samples. Keep supplier form touch targets at least 44 px and preserve entered values on validation errors.

**VERIFY:** Run the full two-browser restaurant/supplier journey and axe scans.

**COMMIT:** `feat: complete end-to-end procurement experience`

### Task 19: Build factual insights, history, repeat request, and settings

**Files:**
- Replace: `src/app/(app)/intelligence/page.tsx`
- Replace: `src/app/(app)/history/page.tsx`
- Replace: `src/app/(app)/settings/page.tsx`
- Create: `src/app/api/insights/route.ts`
- Create: `src/app/api/history/route.ts`
- Create: `src/app/api/requests/[id]/repeat/route.ts`
- Create: `src/app/api/settings/route.ts`
- Create: `__tests__/e2e/history-settings.spec.ts`

**RED:** Test paginated factual history, price/response/coverage insights only from submitted records, quote variance labeling, Run again creating a draft without mutating history, OWNER settings/members, and MEMBER denial.

**GREEN:** Keep `/intelligence` as a compatibility redirect to `/insights`; remove all simulated trend, forecast, risk, and savings data.

**VERIFY:** E2E and API tests with seeded actual records.

**COMMIT:** `feat: add factual insights history and settings`

### Task 20: Remove legacy runtime authority and paid-service dependencies

**Files:**
- Delete: legacy simulation, agent, ML, Inngest, email webhook, demo seed, RAG, recommendation, pricing, risk, and distributor discovery routes and libraries
- Modify: `package.json`
- Modify: `next.config.ts`
- Modify: instrumentation and environment files
- Create: `__tests__/architecture/no-legacy-runtime.test.ts`

**RED:** Assert production source imports no OpenAI, Groq/LangChain, Chroma, Inngest, Resend, or hosted Sentry SDK and exposes no simulation/demo route as product authority.

**GREEN:** Remove unused code and dependencies after the replacement workflows pass. Keep only necessary UI/runtime packages and run license/secret checks.

**VERIFY:** Clean install, dependency audit, full test, lint, typecheck, and build.

**COMMIT:** `refactor: remove simulated and paid runtime paths`

---

## Phase 4: Hosting, verification, and launch

### Task 21: Add production container, environment validation, and health

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/app/api/health/live/route.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `next.config.ts`
- Modify: `.env.sample`
- Create: `__tests__/ops/health.test.ts`

**RED:** Test missing/invalid environment failure, public build independence, liveness without DB, readiness with a bounded DB query, and no secret output.

**GREEN:** Build a non-root multi-stage image, standalone Next output, graceful shutdown, bounded connection settings, and clear environment schema.

**VERIFY:** Build/run the container and hit health routes.

**COMMIT:** `ops: add production container and health checks`

### Task 22: Add cost-bounded CI, deploy, backup, restore, and runbooks

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-cloud-run.yml`
- Create: `.github/workflows/backup-postgres.yml`
- Create: `scripts/backup-postgres.sh`
- Create: `scripts/restore-verify.sh`
- Create: `scripts/canary.sh`
- Create: `infra/cloud-run/service.yaml`
- Create: `docs/runbooks/{deployment,rollback,incident,backup-restore,cost-boundaries}.md`

**RED:** Add shell/static tests that fail when Cloud Run is not min 0/max 2/concurrency 20/512 MiB, secrets appear in workflow literals, backup encryption is skipped, retention exceeds 30 daily + 4 monthly, or CI schedules duplicate test work.

**GREEN:** Use GitHub OIDC, Artifact Registry two-image retention, Cloud Run asia-south1 request billing, encrypted `pg_dump` to R2, explicit 8 GB safety stop, monthly disposable restore verification, and post-deploy canary. Budget alerts are documented as warnings, not hard caps.

**VERIFY:** Workflow validation, local backup/restore against disposable Postgres, and canary against local container.

**COMMIT:** `ops: add free-first deployment and recovery controls`

### Task 23: Prove launch readiness under realistic load

**Files:**
- Create: `tests/load/organizations.js`
- Create: `docs/reports/launch-verification.md`

**RED:** Define thresholds before running: 20 organizations, isolated data, concurrent public quote submissions, no errors, authenticated p95 below 800 ms under the documented local profile, and no pool saturation.

**GREEN:** Fix only observed bottlenecks. Do not add cache, Redis, worker, or denormalized analytics without measured need.

**VERIFY:** Full unit/API/integration/E2E suite, clean database migration, forced RLS matrix, complete procurement journey, encrypted restore, dependency/license/secret scan, production build, and load profile. Record commands and evidence in the report.

**COMMIT:** `test: prove launch readiness`

### Task 24: Rewrite README, ship, deploy, and monitor

**Files:**
- Replace: `README.md`

**RED:** Audit README claims against the finished routes, environment, schema, tests, deployment, and known limits. Any undocumented required step or inaccurate feature claim fails the task.

**GREEN:** Rewrite README with the real product, local setup, environment table, architecture, data/security boundaries, workflow, tests, Cloud Run/Supabase/R2 deployment, cost ceilings and upgrade triggers, backup/restore, troubleshooting, and deferred scope.

**VERIFY:** Run every documented setup/check command from a clean install where practical. Push the branch, open a PR, wait for required checks and preview, perform review, merge, deploy production Cloud Run, run canary, and monitor initial health. If credentials or external project creation need user action, provide the exact minimum handoff while completing every repository-side step.

**COMMIT:** `docs: publish production launch guide`

---

## Execution order and parallel safety

- Tasks 1-5 establish the non-negotiable security boundary and run sequentially where migrations overlap.
- After Task 6, menu and supplier work may proceed in parallel if agents do not edit `schema.prisma`, `package.json`, shared migrations, or the same route tree.
- Public brand/site work can proceed alongside domain APIs because `/` must not depend on auth or database code.
- UI tasks start only after their APIs are green; legacy code is removed only after replacement E2E flows pass.
- Deployment begins only after one full clean local verification. README remains the final repository edit.

## Definition of done

Done means all required tests and build pass, the disposable migration and forced-RLS matrix pass, the complete restaurant/supplier/award/PO journey passes, backup restore is proven, the branch is reviewed and merged, the hosted service is healthy, the canary is green, and README describes exactly what exists. A mock screen, green build without PostgreSQL isolation, or an unmerged branch is not done.
