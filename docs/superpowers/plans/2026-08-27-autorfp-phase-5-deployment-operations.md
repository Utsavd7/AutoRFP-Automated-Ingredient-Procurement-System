# AutoRFP Phase 5 Deployment and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the verified product on one rebuildable OCI Always Free ARM64 node with TLS, bounded resources, monitoring, encrypted backups, and a tested two-hour recovery procedure.

**Architecture:** One Docker Compose project runs Caddy, web, worker, PostgreSQL, llama.cpp, Prometheus, Grafana, and pgBackRest. Only Caddy publishes ports. OpenTofu-compatible OCI definitions create exactly one Always Free compute shape, one boot volume, one data volume, one object bucket, and least-privilege networking. Release scripts migrate, replace, check readiness, run a canary, and roll back the application image.

**Tech Stack:** Docker Compose, Caddy, PostgreSQL, pgBackRest, llama.cpp, Prometheus, Grafana OSS, Pino, OpenTelemetry, OpenTofu/Terraform OCI provider, Syft, Grype/Trivy, Gitleaks.

---

## Simplicity boundary

No Kubernetes, Helm, service mesh, managed database, Redis, log SaaS, tracing backend, multi-region setup, or auto-scaling. Keep one hand-written dashboard, one alert rules file, one release script, and one restore script. Monitoring exists to operate the pilot, not to create a platform team.

## File map

Create:

- `Dockerfile`
- `deploy/compose.yaml`
- `deploy/caddy/Caddyfile`
- `deploy/postgres/postgresql.conf`
- `deploy/postgres/pg_hba.conf`
- `deploy/pgbackrest/pgbackrest.conf`
- `deploy/prometheus/prometheus.yml`
- `deploy/prometheus/alerts.yml`
- `deploy/grafana/provisioning/`
- `infra/oci/main.tf`, `variables.tf`, `outputs.tf`, `cloud-init.yaml`
- `scripts/deploy.sh`, `scripts/rollback.sh`, `scripts/backup.sh`, `scripts/restore-verify.sh`, `scripts/canary.ts`
- `src/instrumentation/telemetry.ts`
- `src/lib/logging/logger.ts`
- `src/lib/http/correlation-id.ts`
- `src/app/health/live/route.ts`
- `src/app/health/ready/route.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/security.yml`
- `docs/operations/deploy.md`, `backup-restore.md`, `incident-response.md`, `zero-cost-boundary.md`

## Task 1: Build one non-root ARM64-compatible application image

- [ ] Add a multi-stage `Dockerfile` with dependency, build, and runtime stages. Use one image for web and worker commands.
- [ ] Pin the Node 20 base image by digest, enable Next standalone output, run as a fixed non-root UID/GID, and copy only runtime artifacts.
- [ ] Add `.dockerignore`; exclude `.env`, tests, local databases, raw imports, model weights, and Git history.
- [ ] Build for `linux/arm64` and run unit tests plus `node --version` inside the image.
- [ ] Scan the image and fix critical/high findings or record a time-bounded exception.
- [ ] Commit with `git commit -m "build: add hardened ARM64 application image"`.

## Task 2: Define the single-node Compose stack and resource limits

- [ ] Add services for Caddy, web, worker, PostgreSQL, llama.cpp, Prometheus, Grafana, and pgBackRest on one private network.
- [ ] Publish only Caddy 80/443. Do not expose PostgreSQL, llama, Prometheus, or Grafana host ports.
- [ ] Set memory ceilings matching the approved 12-GB budget and CPU priority so web/database remain responsive during AI inference.
- [ ] Mount the separate data volume for PostgreSQL and generated business documents. Keep model weights read-only.
- [ ] Add restart policies, health checks, read-only root filesystems where compatible, `no-new-privileges`, dropped capabilities, and tmpfs scratch directories.
- [ ] Run `docker compose -f deploy/compose.yaml config` and a local ARM64 smoke start.

Expected: valid config; only Caddy is reachable from the host.

- [ ] Commit with `git commit -m "ops: define bounded single-node production stack"`.

## Task 3: Add TLS and public HTTP security at Caddy

- [ ] Configure `AUTORFP_DOMAIN`, automatic TLS, request-body limits, timeouts, and reverse proxy to web.
- [ ] Add HSTS only after certificate/domain verification, CSP, `frame-ancestors 'none'`, `nosniff`, restrictive permissions policy, and `Referrer-Policy: no-referrer` on supplier pages.
- [ ] Disable or redact access logging for `/quote` fragment exchange and supplier APIs so invitation material and quote text never enter logs.
- [ ] Route `/ops/grafana` only through an operator-authenticated/private access rule; anonymous Grafana is disabled.
- [ ] Add curl-based header tests for public, authenticated shell, and supplier pages.
- [ ] Commit with `git commit -m "ops: terminate TLS with restrictive HTTP security"`.

## Task 4: Add structured logs, correlation, health, and minimal metrics

- [ ] Install Pino and the required OpenTelemetry packages; do not add a log or trace backend.
- [ ] Generate/propagate one correlation ID per request and job. Add trace IDs to structured logs without logging bodies, tokens, contacts, or model prompts.
- [ ] Implement `/health/live` with no dependency call and `/health/ready` checking database, expected migration, and critical configuration.
- [ ] Export the required HTTP, database-pool, queue, AI, ingestion, backup, and host/process metrics for Prometheus.
- [ ] Provision one Grafana operations dashboard and one Prometheus alert file covering the thresholds in the specification.
- [ ] Test redaction and health failure modes.
- [ ] Commit with `git commit -m "ops: add health checks and minimal operational telemetry"`.

## Task 5: Configure encrypted PostgreSQL backup and restore verification

- [ ] Configure pgBackRest with repository encryption, continuous WAL archiving to OCI Object Storage's S3-compatible endpoint, nightly full backup, and the approved seven-daily/four-weekly retention within a 14-GB budget.
- [ ] Keep repository encryption key outside the VM/repository and inject it as a runtime secret.
- [ ] Add daily data-volume backup instructions capped at five free backups and a weekly encrypted logical export procedure to operator-controlled offline storage.
- [ ] Implement `backup.sh` for backup/check/report and `restore-verify.sh` for an isolated temporary restore, migrations, integrity queries, and the synthetic journey.
- [ ] Make backup age, latest verification, repository size, and restore-point count visible to Prometheus.
- [ ] Test a corrupted checksum, missing WAL segment, wrong key, and successful point-in-time restore.
- [ ] Commit with `git commit -m "ops: add encrypted backup and automated restore verification"`.

## Task 6: Define only Always Free OCI infrastructure

- [ ] Define one `VM.Standard.A1.Flex` instance with exactly 2 OCPUs/12 GB, 100-GB boot volume, 100-GB data volume, one object bucket, VCN/subnet, ports 80/443, and source-restricted or Bastion-only SSH.
- [ ] Add variable validation that rejects non-A1 shapes, more CPU/RAM/storage, and unapproved regions. Do not define a paid fallback or load balancer.
- [ ] Use cloud-init only for Docker, volume mount, firewall, deployment user, and repository/bootstrap prerequisites.
- [ ] Add OCI budget/alarm instructions at the smallest supported non-zero threshold and a manual check that all resources carry the Always Free eligibility indicator.
- [ ] Run `tofu fmt -check`, `tofu validate`, and inspect `tofu plan`; save no state or secret in Git.
- [ ] Commit with `git commit -m "infra: define OCI Always Free pilot node"`.

## Task 7: Add secrets, SBOM, and security gates

- [ ] Use SOPS with age or Docker secrets for production values. Commit only encrypted configuration and public age recipients; private keys stay off the VM/repository.
- [ ] Add Gitleaks, dependency audit, Syft SBOM, license inventory, and container scan commands to CI with pinned action/tool versions.
- [ ] Fail on committed secrets and unapproved licenses. Fail on critical/high known vulnerabilities unless an owner-approved dated exception exists.
- [ ] Publish SBOM and scan reports as release artifacts, not public application endpoints.
- [ ] Commit with `git commit -m "ci: add secrets dependency and image security gates"`.

## Task 8: Add forward-compatible deploy, rollback, and canary

- [ ] Implement `deploy.sh`: verify digest-pinned images, recent backup, migration preflight, pause worker, run migration as owner role, replace web, wait for readiness, resume worker, and run canary.
- [ ] Implement one-release application rollback. Migrations in every release must remain compatible with the prior application image.
- [ ] Implement the canary in a dedicated organization: create reviewed menu/demand/RFP, submit a test quote through a fresh invitation, compare, then delete/expire canary business data according to policy.
- [ ] Record deployment version, migration, image digests, backup ID, and canary result in an append-only deployment log.
- [ ] Test failed readiness and failed canary rollback locally.
- [ ] Commit with `git commit -m "ops: add safe deploy rollback and procurement canary"`.

## Task 9: Perform the clean-node recovery drill

- [ ] Provision a clean approved node or isolated equivalent from the infrastructure definitions.
- [ ] Restore the latest encrypted backup and retained WAL using only the runbook and off-host key.
- [ ] Verify RLS, users/sessions, invitations, quotes, audit, outbox, documents, and the canary journey.
- [ ] Measure RPO and RTO; target ≤15 minutes and ≤2 hours after compute is available.
- [ ] Document every manual step or missing prerequisite and update automation/runbook once.
- [ ] Repeat until the drill passes without tribal knowledge.
- [ ] Commit with `git commit -m "docs: record passing backup and rebuild drill"`.

## Task 10: Prove the Phase 5 exit gate

- [ ] Run full CI, security scans, SBOM/license checks, ARM64 image scan, Compose smoke, header checks, backup verification, and canary.
- [ ] Confirm steady-state memory allocations total no more than 10.5 GB, leaving 1.5 GB headroom.
- [ ] Confirm no deployment command can select a paid shape or silently create a fallback resource.
- [ ] Run `npm test`, integration/e2e/worker suites, lint, typecheck, and build.
- [ ] Commit verification fixes with `git commit -m "test: verify zero-cost production operations gate"`.

## Phase 5 exit gate

- [ ] A clean node can be provisioned, restored, and verified inside the RTO after capacity exists.
- [ ] WAL/full backups meet RPO and retention; encryption key is off-host.
- [ ] Only 80/443 are public; all containers run with reviewed limits and security settings.
- [ ] Alerts cover application, auth, database, queue, AI, source freshness, backup, disk, and host failure.
- [ ] Release SBOM/license/security reports pass and no paid resource or API is required.
