# AutoRFP India-First Production Program Implementation Plan

> **Superseded on 2026-08-27.** Do not execute this OCI, Better Auth, worker, or local-AI plan suite. A new lean plan will be written from `../specs/2026-08-27-launch-product-experience-design.md` after user review.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current AutoRFP demonstration into an invite-only, real-user procurement product for 1–10 Indian restaurant organizations, prove it at 20 organizations, and keep recurring infrastructure at ₹0 while OCI Always Free capacity remains available.

**Architecture:** Deliver seven gated phases. The core is a Next.js web process and a separate worker using PostgreSQL as the authoritative store, forced row-level security for organization isolation, pg-boss for jobs, and optional local llama.cpp inference. One OCI Always Free ARM64 node runs the launch stack; its interfaces allow AI, PostgreSQL, and the web tier to move to separate hosts later without changing product behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL, Prisma during migration, Better Auth, `@node-rs/argon2`, pg-boss, llama.cpp, Qwen3.5 4B/2B, Caddy, Docker Compose, OpenTelemetry, Prometheus, Grafana OSS, Jest, Playwright, Testcontainers, k6, Terraform/OpenTofu-compatible HCL.

---

## Source of truth

Implement against [the approved production design](../specs/2026-08-27-india-first-zero-cost-production-design.md). If a task conflicts with that specification, stop the phase and amend the specification before changing code.

## Why this is a plan suite

The approved design contains seven independently testable subsystems. A single mega-plan would make exact paths and tests stale as soon as the schema changes. Execute these plans in order, and do not start a later plan before the preceding exit gate passes:

| Order | Plan | Required outcome |
|---:|---|---|
| 0 | [Phase 0 — Safety baseline](2026-08-27-autorfp-phase-0-safety-baseline.md) | No secret disclosure, unauthenticated tenant API, SSRF, fabricated live data, or enabled fake workflow |
| 1 | [Phase 1 — Identity and tenancy](2026-08-27-autorfp-phase-1-identity-tenancy.md) | Better Auth, memberships, roles, forced PostgreSQL RLS, audit and outbox foundations |
| 2 | [Phase 2 — Deterministic procurement](2026-08-27-autorfp-phase-2-procurement-workflow.md) | Real menu-to-demand-to-RFP-to-quote-to-award-to-PO journey |
| 3 | [Phase 3 — India evidence](2026-08-27-autorfp-phase-3-india-evidence.md) | Provenanced government price observations, invoice history, verified suppliers |
| 4 | [Phase 4 — Local AI and jobs](2026-08-27-autorfp-phase-4-local-ai-jobs.md) | pg-boss worker and optional local AI that cannot block or control procurement |
| 5 | [Phase 5 — Deployment and operations](2026-08-27-autorfp-phase-5-deployment-operations.md) | Rebuildable OCI free-tier deployment, monitoring, encrypted backup, tested restore |
| 6 | [Phase 6 — Staged pilot and scale proof](2026-08-27-autorfp-phase-6-staged-pilot.md) | Controlled 1→3→10 rollout and a passing 20-organization load test |

## Non-negotiable program constraints

- No production path may require a paid API, free trial, credit balance, or proprietary hosted application service.
- No browser-supplied organization or tenant identifier is authoritative.
- No price, supplier, quote, negotiation, award, sending action, or savings value may be simulated and presented as real.
- All currency is INR and authoritative money is integer paise.
- AI is asynchronous and advisory. It cannot send, award, mutate an issued RFP, or calculate authoritative financial values.
- PostgreSQL RLS is the tenant boundary. Application filters are defense in depth only.
- Supplier access uses scoped, expiring, revocable high-entropy invitations; raw tokens are never stored or logged.
- The core workflow must remain usable when the model process is stopped.
- No phase is complete until its tests, security checks, and explicit exit gate pass.

## Simplicity budget

This program must solve proven launch needs, not imitate a large enterprise platform:

- One deployable repository, one PostgreSQL database, one web process, and one worker process at launch.
- No Kubernetes, service mesh, Redis, event-stream platform, API gateway product, separate vector database, or custom internal framework.
- Add an interface only at a real external boundary: database transaction, queue, government data adapter, local model, or object storage.
- Prefer a plain function and a database constraint over a generic engine, plugin system, agent graph, or rule DSL.
- Implement only Owner, Procurement Manager, and Viewer. Do not build configurable role designers.
- Implement only INR, Indian tax inputs, and `g`/`ml`/`ea` canonical dimensions at launch.
- Use deterministic calculations and visible business rules. AI wording must be optional, factual, reviewable, and absent when it adds no user value.
- Delete replaced demo code and dependencies; do not maintain parallel old and new production paths.
- Any new container, queue, table, dependency, abstraction, or dashboard panel requires a named acceptance criterion from the approved specification.

## Shared execution conventions

- Use Node.js 20 LTS on developer machines and in CI/production images.
- Keep npm and `package-lock.json`; do not introduce a second JavaScript package manager.
- Write the failing test first, run it and confirm the expected failure, add the smallest production change, then rerun the focused test.
- Use a real PostgreSQL container for migration, RLS, transaction, pg-boss, and idempotency tests. SQLite and mocks do not prove these properties.
- Commit after each task using the commit text specified in the phase plan. Do not combine unrelated tasks.
- At each phase end run:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all four commands exit `0`. Any approved temporary test exclusion must be documented in the phase plan and removed before Phase 5.

## Program definition of done

- [ ] All seven phase exit gates pass in order.
- [ ] The complete acceptance list in Section 27 of the approved design is demonstrated with evidence.
- [ ] A production-equivalent ARM64 run passes the 20-organization capacity profile.
- [ ] A current encrypted backup restores into a clean environment and the synthetic procurement journey succeeds.
- [ ] The SBOM and license report contain every runtime library, container, and model artifact and show no unapproved paid service dependency.
- [ ] The operator runbook explains the ₹0 boundary, free-tier outage behavior, capacity triggers, and the explicit approval required before any billable fallback.
