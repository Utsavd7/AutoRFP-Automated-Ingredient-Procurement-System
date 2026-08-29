# Incident runbook

## Triage

1. Record UTC time, reporter, affected route, tenant scope, and the last successful canary. Do not copy credentials, cookies, database URLs, or supplier-token paths into tickets or chat.
2. Check Vercel status and Hobby usage, Neon status/storage/compute/transfer, the readiness endpoint, and the latest CI/deploy/backup runs.
3. Classify the incident: availability, authentication, tenant isolation, public-link exposure, incorrect commercial record, or backup failure.

## Containment

- For possible cross-tenant access or leaked public tokens, stop the affected workflow, revoke the relevant grants, preserve minimal audit evidence, and keep production paused until isolation is proven.
- For incorrect awards or quotes, do not edit immutable history. Record the factual correction outside the product until a reviewed corrective workflow exists.
- For capacity exhaustion, pause onboarding or the affected operation. Do not attach a card, enable paid overage, recharge credits, or upgrade automatically.
- For a bad release, follow the [rollback runbook](rollback.md).

## Recovery and review

Run unit, PostgreSQL isolation, complete browser journey, and canary checks appropriate to the incident. Restore only into the validated disposable database unless a separately reviewed production-restore decision exists. After recovery, document the cause, customer impact, evidence, actions, and one concrete prevention item without exposing secrets.
