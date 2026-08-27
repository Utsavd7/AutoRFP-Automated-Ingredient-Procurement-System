# AutoRFP Phase 6 Staged Pilot and Scale Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard real Indian restaurant users gradually, prove the system at the approved 20-organization workload, and stop expansion when security, financial, recovery, or capacity evidence is insufficient.

**Architecture:** A small operator-run pilot moves through explicit 1→3→10 gates. k6 drives authenticated and supplier traffic against a production-equivalent ARM64 deployment with a realistic database. Existing application metrics and audit records provide evidence. A weekly one-page review applies fixed scale triggers; there is no automated paid scaling.

**Tech Stack:** k6, Playwright canary, PostgreSQL fixtures, Prometheus/Grafana, Markdown runbooks.

---

## Simplicity boundary

No analytics warehouse, CRM, feature-flag platform, experimentation framework, automated billing, customer-success bot, or bespoke admin console. Use one onboarding checklist, one incident register, one capacity dashboard, and one weekly review document.

## File map

Create:

- `load/seed.ts`
- `load/scenarios/authenticated.js`
- `load/scenarios/supplier-quotes.js`
- `load/scenarios/ai-contention.js`
- `load/thresholds.js`
- `scripts/load-seed.ts`
- `scripts/load-cleanup.ts`
- `docs/pilot/onboarding-checklist.md`
- `docs/pilot/support-runbook.md`
- `docs/pilot/weekly-scale-review.md`
- `docs/pilot/incident-register.md`
- `docs/pilot/acceptance-evidence.md`
- `docs/privacy/privacy-notice.md`
- `docs/privacy/data-request-runbook.md`
- `docs/privacy/breach-response.md`

## Task 1: Build deterministic production-scale test data

- [ ] Implement a seed script creating exactly 20 organizations, five users each, 5,000 suppliers, 2,000 RFPs, and 20,000 quote lines with valid ownership and state transitions.
- [ ] Use fixed seed input and organization-specific identifiers so reruns are reproducible. Mark every record as load-test data and forbid execution against a database lacking `ALLOW_LOAD_TEST_SEED=true`.
- [ ] Create data through domain/services where practical; direct bulk insert is allowed only for historical closed records after constraints are tested.
- [ ] Add integrity queries for counts, award totals, invitation scope, audit/outbox linkage, and zero cross-organization references.
- [ ] Add a cleanup script requiring the exact load-test dataset ID; it must refuse broad deletion.
- [ ] Run seed→integrity→cleanup against an isolated PostgreSQL database.
- [ ] Commit with `git commit -m "test: add reproducible 20-organization load dataset"`.

## Task 2: Implement the approved k6 workload without synthetic vanity traffic

- [ ] Create one authenticated scenario mixing menu/demand/RFP reads and normal writes across 20 concurrent users.
- [ ] Create one supplier scenario bursting ten quote submissions per second for ten seconds with unique valid invitations and idempotency keys.
- [ ] Create one contention scenario running the core mix while exactly one local AI job is active.
- [ ] Set thresholds: <1% unexpected HTTP errors, authenticated non-AI p95 <750 ms, supplier read/submit p95 <1 s.
- [ ] Collect response status classes, latency, database CPU recovery, queue age, duplicate quote versions, audit/outbox mismatch, and RLS failures.
- [ ] Run a short local smoke first. Expected: scripts complete and deliberate 4xx validation/rate-limit responses are excluded from server-error rate but still reported.
- [ ] Commit with `git commit -m "test: add representative pilot load scenarios"`.

## Task 3: Run the production-equivalent ARM64 capacity test

- [ ] Restore or seed the load dataset on the exact 2-OCPU/12-GB ARM64 shape with production container limits.
- [ ] Warm the application using the canary, then run authenticated, supplier burst, and AI-contention scenarios in that order.
- [ ] Confirm no tenant leak, duplicate quote version, lost audit event, inconsistent award, container OOM, or database connection exhaustion.
- [ ] Confirm database CPU returns below 60% within two minutes and core latency stays within target while AI runs.
- [ ] Save k6 output, Grafana snapshots, application version, migration, image/model hashes, and test-data seed in `docs/pilot/acceptance-evidence.md`.
- [ ] If a threshold fails, diagnose and fix the measured bottleneck; do not add cache/services without evidence that a database/index/query fix is insufficient.
- [ ] Commit the passing report with `git commit -m "perf: record passing 20-organization capacity test"`.

## Task 4: Complete privacy and support readiness

- [ ] Write a plain-language India pilot privacy notice covering user, supplier-contact, procurement, audit, model, retention, export, correction, and deletion data.
- [ ] Document organization export, correction, deletion request, legal/audit retention exceptions, and identity verification steps.
- [ ] Write breach-response steps for containment, affected-data identification, audit preservation, recovery, and notification/legal decision workflow.
- [ ] Test one organization export and one deletion request in an isolated pilot organization; confirm raw imports expire after 30 days and business records follow configured retention.
- [ ] Perform legal review before onboarding external restaurants; record reviewer/date/decisions without treating this engineering plan as legal advice.
- [ ] Commit with `git commit -m "docs: add pilot privacy and data-request operations"`.

## Task 5: Onboard the first internal restaurant organization

- [ ] Complete the onboarding checklist: owner invitation/TOTP, one location, confirmed suppliers, menu review, real RFP, supplier quote, award, PO, export, backup visibility, and support contact.
- [ ] Observe two complete real RFP cycles. Record defects and operator interventions in the incident register.
- [ ] Block expansion for any cross-tenant exposure, incorrect money/unit total, lost record, unusable supplier link, or failed restore verification.
- [ ] Remove test/demo data from user-visible screens and confirm no model-generated value is mistaken for business evidence.
- [ ] Record gate decision with owner approval.

Expected: one organization completes two real cycles without a severe incident.

- [ ] Commit only runbook/evidence updates with `git commit -m "ops: complete one-organization pilot gate"`.

## Task 6: Expand to three organizations

- [ ] Invite two more organizations and repeat the same checklist; do not add custom per-customer workflow branches.
- [ ] Require two successful real RFP cycles for each organization.
- [ ] Review support volume, supplier completion rate, p95 latency, queue age, source freshness, backups, and security events weekly.
- [ ] Fix only repeated usability/reliability problems that affect the approved workflow; record feature requests separately.
- [ ] Run a restore verification during this stage and confirm all three organizations remain isolated.
- [ ] Record gate decision with owner approval.
- [ ] Commit with `git commit -m "ops: complete three-organization pilot gate"`.

## Task 7: Expand to ten organizations for 30 incident-free days

- [ ] Add organizations in small batches only while backup, disk, memory, latency, and support thresholds remain healthy.
- [ ] Require 30 consecutive days without severe isolation, financial-correctness, or data-loss incident before declaring the ten-organization gate passed.
- [ ] Run the weekly fixed scale-trigger review: interactive p95, AI queue age, database CPU, host memory, storage/backup budget, active organizations/users.
- [ ] If any trigger occurs in two consecutive reviews, start the specified separation action before more onboarding. Backup-retention pressure causes an immediate onboarding freeze.
- [ ] Record the final ten-organization evidence and owner approval.
- [ ] Commit with `git commit -m "ops: complete ten-organization pilot gate"`.

## Task 8: Decide expansion to 20 or trigger separation

- [ ] Rerun the full 20-organization load profile against the current release and current data-size projection.
- [ ] Verify 99.5% monthly availability target, latest ≤15-minute RPO evidence, latest ≤2-hour restore, and no unresolved high-severity security/financial defect.
- [ ] If all thresholds pass, onboard toward 20 with the same checklist and weekly review.
- [ ] If a trigger fails, stop onboarding and execute only the prescribed order: move AI first, PostgreSQL second, web replicas third. Any billable infrastructure requires explicit owner approval.
- [ ] Do not change public interfaces or financial/domain behavior during separation.
- [ ] Record the decision in `acceptance-evidence.md`.

## Task 9: Close the production acceptance checklist

- [ ] Demonstrate all 14 product acceptance criteria from the approved design and link each to a test, run, audit entry, report, or restore artifact.
- [ ] Confirm all runtime components/model artifacts appear in the reviewed SBOM/license inventory.
- [ ] Confirm no paid API key or billable cloud fallback is configured.
- [ ] Confirm incident, privacy, support, deployment, backup, and scale runbooks have named owners and were exercised.
- [ ] Run the full test/build/security/canary/backup verification suite one final time.
- [ ] Commit with `git commit -m "docs: record India pilot production acceptance"`.

## Phase 6 exit gate

- [ ] 1→3→10 rollout gates passed with the required real cycles and incident-free window.
- [ ] Current production release passes the 20-organization workload and all latency/integrity thresholds.
- [ ] Privacy, data requests, breach response, support, backup, restore, and scale reviews are exercised.
- [ ] Expansion to 20 is evidence-backed, or onboarding is frozen and the prescribed scale action is recorded.
- [ ] No paid API or silently billable resource is required.
