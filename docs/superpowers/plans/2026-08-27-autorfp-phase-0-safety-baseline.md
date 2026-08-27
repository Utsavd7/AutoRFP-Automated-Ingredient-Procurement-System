# AutoRFP Phase 0 Safety Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current application safe to run while production foundations are built: close secret and tenant leaks, remove arbitrary URL fetching, disable fabricated operational behavior, and make the default UI honest.

**Architecture:** Add one shared API authentication guard, RFC 9457-style error responses, and a fail-closed legacy-feature gate. Keep only authenticated, non-fabricated behavior enabled. Legacy demo routes remain available solely for explicit local development and are impossible to enable in production. The menu endpoint accepts bounded pasted text, derives its tenant from the session, uses local inference only, and falls back to an honest review draft rather than fake dishes.

**Tech Stack:** Next.js Route Handlers, TypeScript, current NextAuth session bridge (temporary until Phase 1), Prisma, Jest, ESLint.

---

## Scope and file map

Create:

- `src/lib/api/problem.ts`
- `src/lib/api/require-api-tenant.ts`
- `src/lib/features/legacy-features.ts`
- `src/lib/menu/menu-input.ts`
- `src/lib/menu/deterministic-draft.ts`
- `src/app/demo-seed/DemoSeedClient.tsx`
- `__tests__/api/problem.test.ts`
- `__tests__/api/require-api-tenant.test.ts`
- `__tests__/api/route-access.test.ts`
- `__tests__/features/legacy-features.test.ts`
- `__tests__/menu/menu-input.test.ts`
- `__tests__/menu/deterministic-draft.test.ts`

Delete:

- `src/app/api/debug-llm/route.ts`

Modify:

- `.env.sample`
- `README.md`
- `src/lib/llm.ts`
- `src/app/api/auth/workspace-check/route.ts`
- `src/app/api/parse-menu/route.ts`
- `src/app/api/quotes/route.ts`
- `src/app/api/pricing/route.ts`
- `src/app/api/distributors/route.ts`
- `src/app/api/risk-score/route.ts`
- `src/app/api/ml/forecast/route.ts`
- `src/app/api/send-rfp/route.ts`
- `src/app/api/simulate-conversation/route.ts`
- `src/app/api/recommend/route.ts`
- `src/app/api/agent/negotiate/route.ts`
- `src/app/api/quote/[rfpId]/route.ts`
- `src/app/api/webhooks/inbound-email/route.ts`
- `src/app/api/demo/seed-account/route.ts`
- `src/app/api/demo/seed-rag/route.ts`
- `src/app/api/inngest/route.ts`
- `src/app/(app)/procurement/page.tsx`
- `src/app/quote/[rfpId]/page.tsx`
- `src/app/demo-seed/page.tsx`

## Task 1: Add safe API responses and the temporary tenant guard

**Files:** Create `src/lib/api/problem.ts`, `src/lib/api/require-api-tenant.ts`; test `__tests__/api/problem.test.ts`, `__tests__/api/require-api-tenant.test.ts`.

- [ ] Write a failing problem-response test that asserts status, `application/problem+json`, stable `type`, `title`, `detail`, and optional field errors.

```ts
import { problemResponse } from '@/lib/api/problem';

test('returns RFC problem details without internal exceptions', async () => {
  const response = problemResponse(422, 'Invalid request', 'Correct the highlighted fields.', {
    errors: { menuText: ['Required'] },
  });
  expect(response.status).toBe(422);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  await expect(response.json()).resolves.toMatchObject({
    type: 'about:blank', status: 422, title: 'Invalid request',
    detail: 'Correct the highlighted fields.', errors: { menuText: ['Required'] },
  });
});
```

- [ ] Run `npm test -- --runTestsByPath __tests__/api/problem.test.ts`.

Expected: FAIL because `@/lib/api/problem` does not exist.

- [ ] Implement `problemResponse(status, title, detail, extensions?)` with `NextResponse.json`, the problem content type, and no exception object or stack field.
- [ ] Write tenant-guard tests that mock `requireTenant`, expecting `{ tenant, response: null }` for a session and a generic 401 problem response otherwise.
- [ ] Implement `requireApiTenant()` as the only temporary adapter around `requireTenant()`; Phase 1 changes its internals without changing route call sites.
- [ ] Run `npm test -- --runTestsByPath __tests__/api/problem.test.ts __tests__/api/require-api-tenant.test.ts`.

Expected: PASS.

- [ ] Commit with `git add src/lib/api __tests__/api && git commit -m "feat: add shared API safety guards"`.

## Task 2: Add a production-impossible legacy feature gate

**Files:** Create `src/lib/features/legacy-features.ts`; modify `.env.sample`; test `__tests__/features/legacy-features.test.ts`.

- [ ] Write table-driven tests for an absent flag, explicit false, development true, test true, and production true.

```ts
import { isLegacyFeatureEnabled } from '@/lib/features/legacy-features';

test.each([
  [{ NODE_ENV: 'development' }, false],
  [{ NODE_ENV: 'development', AUTORFP_ENABLE_LEGACY_DEMO: 'true' }, true],
  [{ NODE_ENV: 'production', AUTORFP_ENABLE_LEGACY_DEMO: 'true' }, false],
])('fails closed for %o', (env, expected) => {
  expect(isLegacyFeatureEnabled(env)).toBe(expected);
});
```

- [ ] Run `npm test -- --runTestsByPath __tests__/features/legacy-features.test.ts`.

Expected: FAIL because the module does not exist.

- [ ] Implement one coarse gate. It returns true only when the flag is exactly `true` and `NODE_ENV !== 'production'`.
- [ ] Add `legacyFeatureUnavailable()` returning a generic 503 problem response with `Retry-After: 3600`.
- [ ] Add safe defaults to `.env.sample`:

```dotenv
AUTORFP_ENABLE_LEGACY_DEMO="false"
NEXT_PUBLIC_AUTORFP_ENABLE_LEGACY_DEMO="false"
AUTORFP_ALLOW_EXTERNAL_AI="false"
```

- [ ] Rerun the focused test. Expected: PASS.
- [ ] Commit with `git add .env.sample src/lib/features __tests__/features && git commit -m "feat: fail closed on legacy demo features"`.

## Task 3: Remove secret disclosure and quarantine demo entry points

**Files:** Delete `src/app/api/debug-llm/route.ts`; modify workspace-check and demo routes/pages; create `src/app/demo-seed/DemoSeedClient.tsx`; test `__tests__/api/route-access.test.ts`.

- [ ] Write a route-surface regression test. Assert the debug route is absent, demo API files call the legacy gate before database/model access, and workspace-check contains no distinct `No workspace exists` response.
- [ ] Run `npm test -- --runTestsByPath __tests__/api/route-access.test.ts`.

Expected: FAIL on all three unsafe conditions.

- [ ] Delete the debug route and do not replace it with another key/status endpoint.
- [ ] Make workspace preflight return the same status and public message for existing and absent emails. Authentication decides whether credentials are valid.
- [ ] Move existing demo client logic to `DemoSeedClient.tsx`. Make `page.tsx` a server component that calls `notFound()` unless the legacy gate is enabled.
- [ ] At the first executable line of each demo POST handler, return `legacyFeatureUnavailable()` unless enabled.
- [ ] Rerun the route-surface test. Expected: PASS.
- [ ] Commit with `git add -A src/app/api/debug-llm src/app/api/auth/workspace-check src/app/api/demo src/app/demo-seed __tests__/api/route-access.test.ts && git commit -m "fix: remove public diagnostics and quarantine demo seeding"`.

## Task 4: Remove arbitrary menu fetching and dishonest fallback data

**Files:** Create `src/lib/menu/menu-input.ts`, `src/lib/menu/deterministic-draft.ts`; modify parse route and `src/lib/llm.ts`; test both new modules.

- [ ] Write menu-input tests for missing body, non-object JSON, blank input, URL in `menuText`, any `sourceUrl` key, input above 100,000 UTF-8 bytes, and valid multiline Indian menu text.
- [ ] Write deterministic-draft tests: each non-empty trimmed line becomes a review-required dish with no invented ingredients; duplicate lines collapse case-insensitively; at most 250 lines are accepted.
- [ ] Run `npm test -- --runTestsByPath __tests__/menu/menu-input.test.ts __tests__/menu/deterministic-draft.test.ts`.

Expected: FAIL because the modules do not exist.

- [ ] Implement `parseMenuInput(body)` as a pure validator. URL-like input and `sourceUrl` return 422 field errors. It must not fetch, follow redirects, or resolve DNS.
- [ ] Implement `buildDeterministicMenuDraft(menuText)` using only user-provided lines. Never use `MOCK_DISHES`, infer hidden ingredients, or invent quantities.
- [ ] Make `callOllama` local-only. Remove its Groq fallback. Make the Groq client unavailable unless `AUTORFP_ALLOW_EXTERNAL_AI === 'true'` and the process is not production.
- [ ] In the parse route, authenticate before reading the body; use only `tenant.id`; remove remote fetch, key-prefix logging, direct Groq calls, mock dishes, and Groq enrichment.
- [ ] The route may attempt Ollama with a short timeout. On unavailable or invalid output, persist the deterministic review draft and return `modelSource: 'Deterministic review draft'` with `requiresReview: true`.
- [ ] Persist `sourceUrl: null` and the validated text. Never write `Manual Input` into a URL column.
- [ ] Run the focused tests, then run `rg -n "fetch\(rawInput|keyPrefix|GROQ_API_KEY present|MOCK_DISHES|sourceUrl \|\|" src/app/api/parse-menu/route.ts src/lib/llm.ts`.

Expected: tests PASS; `rg` returns no matches.

- [ ] Commit with `git add src/lib/menu src/lib/llm.ts src/app/api/parse-menu/route.ts __tests__/menu && git commit -m "fix: accept bounded menu text without remote fetching"`.

## Task 5: Stop trusting client tenant identifiers

**Files:** Modify `quotes`, `pricing`, `distributors`, `risk-score`, `ml/forecast`, `send-rfp`, `simulate-conversation`, `recommend`, `agent/negotiate`, and `webhooks/inbound-email` routes; extend `__tests__/api/route-access.test.ts`.

- [ ] Add an explicit internal-route matrix to the test. Every route must import and call `requireApiTenant`; route source must not read `tenantId` from request JSON or query parameters.

```ts
const authenticatedRoutes = [
  'parse-menu', 'quotes', 'pricing', 'distributors', 'risk-score',
  'ml/forecast', 'send-rfp', 'simulate-conversation', 'recommend',
  'agent/negotiate', 'webhooks/inbound-email',
];
```

- [ ] Run the route-surface test. Expected: FAIL and identify every unguarded route.
- [ ] Add the guard at the start of each handler. For SSE negotiation, authenticate before creating the stream and return a normal 401 response.
- [ ] Remove defaults such as `tenant_demo`. Use `tenant.id` in every query, create, metadata object, and job payload.
- [ ] Scope parent lookups before mutations. A foreign RFP or menu ID must behave as not found.
- [ ] Keep inbound-email authenticated only as a local development simulator. Phase 2 replaces it with supplier-token submission.
- [ ] Run the test, then `rg -n "tenant_demo|searchParams\.get\(['\"]tenantId|tenantId\s*=\s*.*req\.json" src/app/api`.

Expected: test PASS; `rg` returns no matches.

- [ ] Commit with `git add src/app/api __tests__/api/route-access.test.ts && git commit -m "fix: derive API tenant context from authenticated sessions"`.

## Task 6: Quarantine fabricated or insecure workflows

**Files:** Modify the quarantined routes and route-surface test.

Quarantined routes:

```text
/api/pricing
/api/distributors
/api/risk-score
/api/ml/forecast
/api/send-rfp
/api/simulate-conversation
/api/recommend
/api/agent/negotiate
/api/quote/[rfpId]
/api/webhooks/inbound-email
/api/inngest
```

- [ ] Extend the test to assert every quarantined handler checks the legacy gate before request parsing, Prisma, outbound calls, email, or stream creation.
- [ ] Run the test. Expected: FAIL on each ungated handler.
- [ ] Add the gate after authentication on internal routes. For the public quote and Inngest routes, add it as the first operation.
- [ ] Keep quarantined code temporarily; Phase 2 replaces supplier flows and Phase 4 removes legacy runtime dependencies.
- [ ] Run `NODE_ENV=production AUTORFP_ENABLE_LEGACY_DEMO=true npm test -- --runTestsByPath __tests__/features/legacy-features.test.ts __tests__/api/route-access.test.ts`.

Expected: PASS and production remains disabled.

- [ ] Commit with `git add src/app/api __tests__/api/route-access.test.ts && git commit -m "fix: quarantine simulated procurement workflows"`.

## Task 7: Make the default UI production-safe and truthful

**Files:** Modify procurement page, quote page, README, and route-surface test.

- [ ] Add a source test rejecting enabled claims such as `live market`, `emails appear here in real time`, and `Submit Official Quote`, plus automatic calls to quarantined endpoints when the public legacy flag is false.
- [ ] Run the test. Expected: FAIL on current copy and auto-pipeline behavior.
- [ ] Define one compile-time `legacyDemoEnabled` boolean from `NEXT_PUBLIC_AUTORFP_ENABLE_LEGACY_DEMO === 'true'` and require it before pricing, discovery, sending, simulation, recommendation, risk, or negotiation handlers run.
- [ ] Make the default post-quantity behavior stop at `Demand draft ready for review`. It must not chain pricing, supplier discovery, or RFP sending.
- [ ] Hide legacy controls when false. Show: `Real supplier requests and market evidence are being enabled in the production workflow. Your reviewed menu draft is saved; nothing has been sent.`
- [ ] In the quote page, render a static unavailable state when the flag is false and do not fetch an RFP ID.
- [ ] Rewrite README so current state and approved target are distinct. Remove claims that current prices are live, email is sent, jobs are reliable, isolation is complete, or negotiation is production-grade.
- [ ] Run the test, then `rg -n "Nothing is hardcoded|emails them RFPs|Production-grade negotiation|automatically scoped|keeps pricing live" README.md`.

Expected: test PASS; `rg` returns no matches.

- [ ] Commit with `git add 'src/app/(app)/procurement/page.tsx' 'src/app/quote/[rfpId]/page.tsx' README.md __tests__/api/route-access.test.ts && git commit -m "fix: present an honest production-safe workflow"`.

## Task 8: Prove the Phase 0 exit gate

**Files:** Modify only when a verification failure requires a scoped fix.

- [ ] Run focused security tests:

```bash
npm test -- --runTestsByPath __tests__/api/route-access.test.ts __tests__/api/require-api-tenant.test.ts __tests__/features/legacy-features.test.ts __tests__/menu/menu-input.test.ts __tests__/menu/deterministic-draft.test.ts
rg -n "keyPrefix|GROQ_API_KEY present|tenant_demo|fetch\(rawInput|sourceUrl\s*\|\|" src
```

Expected: tests PASS; `rg` returns no matches.

- [ ] Run `npm run build`, start the production server, and probe `/api/debug-llm`, `/api/send-rfp`, `/api/parse-menu`, and `/api/quote/not-a-real-id` without a session.

Expected: debug 404; internal routes 401; automated authenticated test proves URL input 422; public legacy quote 503 with no RFP existence signal.

- [ ] Run the full quality gate:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all commands exit `0`. This phase owns the existing lint debt so Phase 1 starts from a trustworthy baseline.

- [ ] Run `git status --short`, `git diff --check`, and `git diff --stat` to confirm only scoped files changed and no whitespace error exists.
- [ ] Commit any verification-only fixes with `git add -A && git commit -m "test: verify Phase 0 production safety gate"`.

## Phase 0 exit gate

- [ ] No response or log exposes any secret or key prefix.
- [ ] Every internal business API requires a session and ignores client tenant identifiers.
- [ ] Menu parsing cannot make outbound requests from user input.
- [ ] Generated, proxy, mock, or AI-estimated data is not displayed as real, live, sent, submitted, or saved supplier activity.
- [ ] All incomplete operational routes are impossible to enable under `NODE_ENV=production`.
- [ ] Test, lint, typecheck, and production build all pass.
