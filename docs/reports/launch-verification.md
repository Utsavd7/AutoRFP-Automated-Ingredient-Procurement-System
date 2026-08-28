# QuotePlate launch verification

This is the evidence record for the launch gate. A row is `PASS` only after the command has completed against the named target and its output has been reviewed. Blank evidence and `PENDING` are not approval to launch.

## Gate status

| Gate | Status | Evidence |
|---|---|---|
| Unit and API tests | PASS (local) | `npm test` — 83 suites / 559 tests passed on 2026-08-28. |
| Real PostgreSQL integration suite | PASS (local) | `npm run test:integration` — 22 suites / 38 tests passed against disposable PostgreSQL on 2026-08-28. |
| Clean migration from an empty database | PASS (local) | Covered by `__tests__/integration/migrations.test.ts`; every committed migration deployed without drift. |
| Forced-RLS two-tenant isolation matrix | PASS (local) | Covered by the real-role integration suite, including unsafe-role rejection, cross-tenant denial, table grants and private-function grants. |
| Complete restaurant-to-supplier procurement journey | PASS (local) | `npm run test:e2e` — 39 passed / 3 intentional skips across desktop, phone and tablet, including menu, request, public quote, comparison, award and export. |
| Encrypted backup restore verification | PENDING (provider) | Script safety, ACL preservation, disposable-target refusal and repeat-cleanup tests pass; a real encrypted provider restore requires the cardless backup environment. |
| Dependency, licence, and secret checks | PASS (local) | Production audit found 0 vulnerabilities; installed licences are open-source/permissive or documented optional LGPL components; secret-pattern review found only fixtures, placeholders and generated local test credentials. |
| Lint and TypeScript | PASS (local) | `npm run lint` and `npm run typecheck` passed on 2026-08-28. |
| Production build | PASS (local) | `npm run build` and `npx --no-install netlify build --offline` completed; Netlify packaged the server function with runtime v5.15.13. |
| 20-organization bounded load profile | PASS (local) | `npx playwright test tests/e2e/load-profile.spec.ts --project=desktop-chromium` — 1/1 passed on 2026-08-28 against a disposable PostgreSQL fixture. |
| Load-runner safety and threshold unit tests | PASS | `node --test tests/load/organizations.test.js` — 6/6 passed on 2026-08-28. |

Overall local release verification: **PASS**. Provider configuration, encrypted remote restore and the production canary remain **PENDING** and cannot trigger billing or an upgrade.

## Fixed load thresholds

These thresholds were defined before the real run:

- Exactly 20 logically isolated organizations.
- One tenant-marker read and at least two additional authenticated reads per organization.
- Every public supplier link resolves to that organization's unique expected marker before submission.
- Exactly one successful public quote submission per organization.
- Zero request errors.
- Zero tenant-marker mismatches.
- Authenticated nearest-rank p95 strictly below 800 ms; 800 ms fails.
- Readiness succeeds before and after the profile.
- Zero readiness failures, request timeouts, or HTTP 503 responses as automated pool-saturation signals.
- Direct database/provider pool telemetry is checked separately during the run. The HTTP runner does not claim to measure pool utilization.

The runner has no duration mode and no retries. It permits exactly 20 organizations, one single-use quote workflow per organization, two or three additional private reads per organization, responses of at most 1 MB, a request timeout of 1–30 seconds, and concurrency of 1–4. This keeps one invocation bounded and prevents an accidental paid-load pattern.

## Load fixture contract

Prepare a disposable JSON fixture outside version control. It must contain exactly 20 entries and must not be reused after successful quote submission because quote revisions are immutable.

```json
{
  "schemaVersion": 1,
  "readinessPath": "/api/health/ready",
  "organizations": [
    {
      "id": "load-org-01",
      "sessionCookie": "next-auth.session-token=REDACTED",
      "isolationMarker": {
        "path": "/api/settings",
        "jsonPath": "workspace.name",
        "equals": "Load Restaurant 01"
      },
      "authenticatedReads": [
        { "name": "overview", "path": "/api/overview" },
        { "name": "requests", "path": "/api/requests?limit=5" }
      ],
      "supplierQuote": {
        "token": "REDACTED_43_CHARACTER_OR_LONGER_BASE64URL_TOKEN",
        "isolationMarker": {
          "jsonPath": "restaurantName",
          "equals": "Load Restaurant 01"
        },
        "submission": {
          "expectedLatestRevision": 0,
          "deliveryDate": "2099-09-02",
          "validUntil": "2099-09-15",
          "freightInr": "0",
          "commercialTerms": "Payment in 15 days.",
          "notes": "Bounded launch verification.",
          "items": [
            {
              "requestItemId": "DISPOSABLE_REQUEST_ITEM_ID",
              "noQuote": false,
              "availableQuantity": "10",
              "unitRateInr": "50",
              "gstPercent": "5",
              "taxInclusive": false,
              "substitution": ""
            }
          ]
        }
      }
    }
  ]
}
```

Each session cookie, supplier token, organization ID, private marker, and public marker must be unique. Read paths must be same-origin `GET` paths and cannot carry token, secret, password, authorization, or API-key query parameters. Do not commit the real fixture or paste its cookies/tokens into this report.

## Commands and evidence

### 1. Runner safety and threshold math

```sh
node --check tests/load/organizations.js
node --test tests/load/organizations.test.js
```

Status: **PASS** on 2026-08-28. Result: 6 tests passed, 0 failed, including a loopback-only 20-organization request exercise. The syntax check must be rerun in the final launch command set.

### 2. Local bounded load profile

Start the production-parity local target with its disposable 20-organization database and create a fresh fixture, then run:

```sh
LOAD_BASE_URL=http://127.0.0.1:3000 \
LOAD_FIXTURE_FILE=/absolute/private/path/organizations.json \
LOAD_CONCURRENCY=4 \
node tests/load/organizations.js
```

Status: **PASS** on 2026-08-28 against the local production build and a fresh disposable PostgreSQL fixture created by the test-only gateway.

Record without secrets:

- Date and source: 2026-08-28; current `codex/phase-0-safety` working tree (release commit not yet created).
- Target environment and origin: local production build at `http://127.0.0.1:52560`.
- Fixture preparation method: 20 unique tenant/user/supplier/request/grant records created in disposable PostgreSQL by `__test/database/load-organizations`; the 0600 fixture file was removed in `finally`.
- Organizations completed: 20/20.
- Authenticated reads: 60.
- Authenticated p95: 85.1 ms in the observed gate run; required threshold is strictly below 800 ms.
- Public quote submissions: 20/20.
- Request errors: 0.
- Isolation mismatches: 0.
- Readiness/timeout/503 signals: 0.
- Direct database pool peak / provider evidence: not claimed by this HTTP profile; provider telemetry remains a production-operations check.
- Result: PASS. A final clean rerun completed 1/1 in 1.1 minutes.

### 3. Remote staging profile

Remote targets are blocked by default. A known non-production staging target requires both an environment declaration and an explicit remote opt-in:

```sh
LOAD_BASE_URL=https://staging.example \
LOAD_TARGET_ENV=staging \
LOAD_ALLOW_REMOTE=1 \
LOAD_FIXTURE_FILE=/absolute/private/path/organizations.json \
LOAD_CONCURRENCY=4 \
node tests/load/organizations.js
```

Status: **PENDING**.

### 4. Production safety gate

Do not run this profile against production for routine verification. Any production run requires fresh operator approval, a fresh disposable fixture, and this exact explicit opt-in:

```sh
LOAD_TARGET_ENV=production \
LOAD_ALLOW_PRODUCTION=I_ACCEPT_BOUNDED_PRODUCTION_LOAD
```

Without that value the runner refuses production. Correctly classify the target; never label a production hostname as staging. No provider upgrade, payment method, paid overage, or billing action is authorized by a load run.

Production load status: **NOT RUN / NOT APPROVED**.

### 5. Full launch verification commands

Run from a clean install on the release commit and paste concise results below. Use the repository's documented PostgreSQL/container setup for commands that require infrastructure.

```sh
npm test
npm run test:integration
npm run test:e2e
npm run lint
npm run typecheck
npm run build
```

Recorded local evidence:

- Empty-database migration command/result: **PASS** in the PostgreSQL integration suite.
- Two-tenant forced-RLS command/result: **PASS** in the PostgreSQL integration suite.
- Complete procurement journey command/result: **PASS**, 39 browser journeys passed across desktop, phone and tablet; 3 intentional duplicate/live-provider checks skipped.
- Encrypted backup/restore command/result: **PENDING** for a real provider object; automation safety tests pass.
- Dependency audit command/result: **PASS**, 0 production vulnerabilities.
- Licence scan command/result: **PASS** for the installed dependency tree; fonts retain their OFL licence file.
- Secret scan command/result: **PASS** for repository source; matches were test fixtures, explicit placeholders or runtime-generated local credentials.
- Production build result: **PASS**, including Netlify offline packaging.

## Final sign-off

- Release commit:
- Reviewer:
- Verification completed at:
- All local code gates pass: **YES**
- Provider gates pass: **NO — production configuration, encrypted restore and canary are pending**
- Fresh approval for any paid service or billing change: **NONE; no paid change is permitted**
