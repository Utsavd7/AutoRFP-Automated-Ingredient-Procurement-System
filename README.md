# QuotePlate

**Every supplier quote. One accountable decision.**

QuotePlate is an India-first restaurant procurement workspace. A restaurant can prepare an ingredient request, collect quotes from its own suppliers without asking them to create accounts, compare the real landed cost, record a whole or split award, and keep the complete commercial history for the next buying cycle.

Built by [Utsav Doshi](https://github.com/Utsavd7) · [Open QuotePlate](https://quoteplate.vercel.app) · [View the repository](https://github.com/Utsavd7/QuotePlate)

![QuotePlate wordmark](public/brand/wordmark-horizontal.svg)

## Product status

The complete launch workflow is implemented. Unit, integration, responsive browser, accessibility, migration, tenant-isolation, production-build, and bounded 20-restaurant load checks pass locally on this branch. The configured production target remains [quoteplate.vercel.app](https://quoteplate.vercel.app); this branch was not redeployed or reverified there as part of the local product-polish work. The release remains fail-closed until the restricted runtime connection, Google sign-in, readiness check, and live canary all pass. No launch step may add a card, enable billing, or accept a paid upgrade.

The controlled launch is sized for **one to four restaurants** on cardless free plans. The code and test profile already cover **20 isolated restaurant workspaces** so the application can grow without a rewrite.

## Product experience

The public site keeps the approved professional header and leads with a rendered sample quote comparison: supplier totals, coverage, terms, and the requirement for a human decision are visible before sign-in. Every example is labelled as sample or illustrative data, including a clear notice that displayed prices are not live market data.

The product tour follows the same request, supplier-response, comparison, and human-award flow as the signed-in workspace. The shared QuotePlate visual system continues through the tour, authentication, app shell, and overview. Browser checks cover the public journey at phone, tablet, and laptop widths, including contained comparison scrolling and no page-level horizontal overflow.

The controlled pilot is limited to approved restaurant workspaces. The onboarding terms state the boundary plainly: no payment card and no billing.

## What a restaurant can do

- Activate a production owner workspace with an approved Google account; invited or existing users can use local credentials where configured.
- Invite team members with expiring, single-use links and sign out from every responsive layout.
- Paste a menu, review dishes and ingredient quantities, correct them, approve the reviewed menu, and track its version number.
- Add, search, edit, deactivate, import, or export up to 500 suppliers per operation in the restaurant's own directory.
- Build a draft request with delivery details, dates, commercial terms, up to 250 items, and up to 20 suppliers.
- Open the request and share a different secure link or QR code with each supplier.
- Let a supplier quote without an account, including partial availability, substitutions, GST, tax-inclusive rates, freight, delivery, validity, terms, and a deliberate no-quote choice.
- Preserve every submitted quote revision instead of silently replacing earlier prices.
- Compare normalized unit rates, coverage, GST, freight, delivery fit, and final landed totals in one view.
- Award the complete request to one supplier or split it item by item, with a human-entered reason and an immutable decision record.
- Download request, comparison, award, and accounting CSVs plus one PDF purchase order per winning supplier.
- Review history and practical spend insights, then repeat an earlier request as a fresh editable draft.

## Why suppliers do not need another app

QuotePlate works with the suppliers a restaurant already knows. Each supplier receives a private, expiring request link and can submit from a phone without registering, installing an app, or joining a marketplace. A restaurant can create, rotate, or revoke that link and see when it was first viewed.

## Why a restaurant keeps using it after meeting a supplier

Direct supplier relationships are expected, not blocked. The lasting value is the next purchase: comparing fresh prices, checking GST and freight, tracking revisions, splitting an award, generating purchase orders, and knowing exactly why a decision was made. Going back to calls and spreadsheets removes that shared record and makes price changes harder to spot.

## Product principles

- **Factual, not automated theatre.** QuotePlate records supplier-entered facts and keeps the final award under human control.
- **No marketplace lock-in.** The restaurant owns its supplier relationships and procurement records.
- **No paid API dependency.** The launch product uses no paid AI, email, SMS, WhatsApp, pricing, payments, or supplier-discovery API.
- **No surprise billing.** Provider-side caps, card removal, and a manual release check protect the free-plan boundary. Project workflows never add a payment method, enable overage, auto-recharge, or accept an upgrade.
- **Useful on an ordinary phone.** The public site, authenticated workspace, forms, tables, dialogs, and supplier quote flow are tested across phone, tablet, and desktop layouts.

## Technology

| Layer | Choice |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Database | PostgreSQL with Prisma 5 |
| Authentication | NextAuth, Google OAuth, Argon2 local credentials |
| Documents | CSV, QR code PNG, and PDF generated inside the application |
| Production host | Vercel Hobby (cardless) — [production address](https://quoteplate.vercel.app) |
| Production database | Neon Postgres Free |
| Automation | GitHub Actions with manual production approval |
| Production backup | Encrypted S3-compatible storage, only when a cardless free provider is configured |
| Self-hosting option | Multi-stage, non-root Docker image |

All production dependencies are open source. There is no LLM, vector database, background-job platform, paid monitoring service, transactional-email vendor, or usage-priced API in the runtime.

## Security model

- Restaurant data isolation and least-privilege runtime access are enforced and covered by database-backed tests.
- Supplier and invitation secrets are random opaque tokens; only their digests are stored.
- Supplier links expire and can be revoked or rotated. Quote revisions and final awards are immutable records.
- Browser mutations require a same-origin check, and public/auth endpoints use bounded bodies and persistent rate limits.
- Authentication responses avoid account-discovery details, and production startup fails closed on unsafe configuration.
- Security headers, private database functions, owner/member authorization, bounded exports, and cursor pagination are verified in automated tests.

## Run locally

### Requirements

- Node.js `24.x`
- npm
- PostgreSQL 15 or newer for manual development
- Docker or a local PostgreSQL installation for the integration and browser suites

Install the exact dependency tree:

```sh
git clone https://github.com/Utsavd7/QuotePlate.git
cd QuotePlate
npm ci --omit=peer
cp .env.sample .env
```

Set the local values documented in `.env.sample`, create an empty development database, and add a migration-owner `DIRECT_URL` to the untracked `.env` file. `DATABASE_URL` is the restricted runtime connection; `DIRECT_URL` is used only by migration commands. Never commit either value. Then apply the committed migrations. Do not use `prisma db push`.

```sh
npx prisma migrate deploy
npm run dev
```

Google OAuth is optional locally. Add its values from `.env.sample` only when you want to exercise the real provider. Never commit a populated `.env` file.

For the fastest clean review, `npm run test:integration` and `npm run test:e2e` create and remove their own disposable local PostgreSQL environments; they do not use a remote database or paid service.

## Verification

```sh
npm test
npm run test:integration
npm run test:e2e
npm run lint
npm run typecheck
npm run build
```

The [GitHub Actions release gate](https://github.com/Utsavd7/QuotePlate/actions/workflows/ci.yml) repeats the full verification set for every pull request and every commit merged to `main`. The database bootstrap accepts only an exact `main` commit whose push workflow passed.

The pull-request workflow repeats lint, type checks, unit tests, real PostgreSQL integration, the production build, responsive browser journeys, and the production dependency audit on a clean Ubuntu runner.

| Gate | Result |
| --- | --- |
| Unit and API tests | 82 suites, 533 tests passed |
| Real PostgreSQL integration | 21 suites, 37 tests passed |
| Responsive end-to-end journeys | 49 passed across desktop, phone and tablet; 3 intentional live-provider/bounded-profile skips |
| Empty-database migrations and forced-RLS isolation | Passed |
| Bounded 20-restaurant profile | Passed with zero errors or tenant mismatches |
| Production dependency audit | 0 vulnerabilities |
| Lint, TypeScript, Next.js build | Passed |
| Vercel-compatible Next.js production build | Passed |

See [docs/reports/launch-verification.md](docs/reports/launch-verification.md) for the evidence and remaining provider gates.

## Free-only production release

The database bootstrap is intentionally separate from hosting. It accepts only an exact commit already on `main`, requires successful CI for that commit, and applies migrations with a step-scoped owner credential. Vercel deploys the same reviewed `main` commit; deployment protection stays enabled until the database, Google OAuth, runtime checks, and canary are ready.

Before a first release:

1. Confirm Vercel Hobby, Neon Free, GitHub, Google, and any optional backup provider are cardless with no paid overage or auto-recharge.
2. Use `NEXTAUTH_URL=https://quoteplate.vercel.app` and configure Google OAuth with the exact callback `https://quoteplate.vercel.app/api/auth/callback/google`; every production owner email must be Google-verified and exactly listed in `QUOTEPLATE_PILOT_EMAILS`.
3. Run the database-only bootstrap workflow for the approved `main` commit.
4. Set the runtime-role password interactively and store only the restricted pooled URL in Vercel.
5. Configure the dedicated read-only backup role and complete one real encrypted restore using the cardless backup environment.
6. Redeploy the verified `main` commit on Vercel Hobby, run the live canary, and only then remove deployment protection. Stop immediately if any provider asks for payment or an upgrade.

Operational instructions:

- [Deployment](docs/runbooks/deployment.md)
- [No-billing boundaries](docs/runbooks/cost-boundaries.md)
- [Backup and restore](docs/runbooks/backup-restore.md)
- [Rollback](docs/runbooks/rollback.md)
- [Incident response](docs/runbooks/incident.md)

## Repository map

```text
src/app/                 public pages, authenticated screens, and route handlers
src/components/          product workspaces and responsive UI
src/lib/                 auth, tenancy, procurement, quotes, awards, exports, reporting
tests/e2e/               complete desktop, phone, and tablet product journeys
tests/load/              bounded 20-restaurant launch profile
__tests__/integration/   real PostgreSQL migration and isolation checks
scripts/                 canary, backup, restore, and operational safeguards
public/brand/            canonical SVG logo, app icon, and social card
docs/                    research, verification, brand, and runbooks
```

## Design and research

- [Brand kit and canonical SVG assets](docs/brand/README.md)
- [India restaurant procurement competitive review](docs/research/india-restaurant-procurement-competitive-review.md)

**QuotePlate** combines the two sides of the product: supplier **quotes** and the restaurant **plate** those purchases ultimately serve. The two document forms in the mark represent a request and a quote moving toward one recorded decision. The product and company names remain provisional until formal trademark, company-name, and domain clearance is completed.
