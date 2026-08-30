# Rollback runbook

Rollback is a human decision and must not bypass the production release gate.

1. Confirm the issue and record the currently deployed SHA and Vercel deployment ID.
2. Contain exposure first. Revoke affected supplier links or pause onboarding when appropriate; do not solve an incident by enabling paid capacity.
3. Choose the latest previously verified commit. Confirm its CI result, schema compatibility, and whether its application code can read the current database.
4. If the rollback needs a database restore, stop and follow [backup and restore](backup-restore.md). Do not mix an application rollback with an unreviewed data rollback.
5. In Vercel, open **QuotePlate → Deployments** and use **Instant Rollback** on the immediately previous verified production deployment. The cardless Hobby plan supports only the previous production deployment; do not upgrade or start billing to reach an older one.
6. Run `CANARY_BASE_URL=https://quoteplate.vercel.app scripts/canary.sh`, then check sign-in, one tenant-scoped list, and one supplier link created after the rollback.
7. Record the cause, rollback SHA, operator, affected interval, and follow-up action.

Never force-push `main`, delete production data, or publish an unverified local build during rollback.
