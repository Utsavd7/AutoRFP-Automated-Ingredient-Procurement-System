# Deployment runbook

QuotePlate production uses Vercel Hobby and Neon Free. The Vercel account is cardless, auto-recharge is unavailable, and no paid add-on or upgrade is authorized. Deployment protection stays enabled until the production database, Google sign-in, startup validation, and live canary all pass.

## One-time setup

1. Confirm the Vercel team still says **Hobby**, has no payment method, and has no paid add-on or external integration that can create charges.
2. Keep the Vercel project linked to the repository's `main` branch. Use the stable free `quoteplate.vercel.app` address when available.
3. Configure Google OAuth with the exact authorized redirect URI `${NEXTAUTH_URL}/api/auth/callback/google`. The verified Google email must exactly match an address in `QUOTEPLATE_PILOT_EMAILS`.
4. Keep the migration-only owner secret in the protected GitHub production environment as `NEON_DIRECT_DATABASE_URL`. Never put that owner connection in Vercel or any running application environment.
5. Confirm Neon says **Free**, uses the Singapore project, the smallest autoscaling range, and scale-to-zero. Migrations use the direct endpoint; the application uses the pooled endpoint.

## Database bootstrap and runtime role

Confirm the chosen commit is on `main` with successful CI, then manually dispatch **Bootstrap QuotePlate production database** with that full SHA and type `BOOTSTRAP_QUOTEPLATE_DATABASE_ONLY`. The workflow applies migrations and cannot publish the website.

The migration creates `autorfp_app` with restricted attributes and no embedded password. Connect interactively as the Neon owner without putting either password in the command line:

```sh
psql "host=YOUR_DIRECT_NEON_HOST dbname=neondb user=YOUR_NEON_OWNER sslmode=require"
```

At the `psql` prompt, run `\password autorfp_app`, enter a random password twice at the hidden prompts, and exit with `\q`. The password never appears in shell history, process arguments, or a committed file.

Store only the restricted `autorfp_app` connection as the Vercel pooled `DATABASE_URL`. Add `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `QUOTEPLATE_PILOT_EMAILS`, and `QUOTEPLATE_RUNTIME_STARTUP_CHECK=1`. Apply secrets to Production only unless a preview explicitly needs isolated test credentials.

## Release

1. Confirm CI is green for the exact `main` commit and recheck the [cost boundary](cost-boundaries.md).
2. Confirm the database bootstrap succeeded and the runtime connection uses `autorfp_app`, never the Neon owner.
3. Redeploy the exact verified commit from Vercel. Do not accept an upgrade, add a card, or enable a paid integration.
4. While deployment protection is still enabled, verify `/api/health/live`, `/api/health/ready`, Google sign-in, sign-out, one tenant-scoped page, and one supplier quote link.
5. Run `CANARY_BASE_URL=https://quoteplate.vercel.app scripts/canary.sh`.
6. Remove deployment protection only after every check passes, then record the commit SHA, deployment ID, operator, time, and canary result.

If any provider asks for payment, billing details, an upgrade, or auto-recharge, stop. Reaching a free limit pauses onboarding or availability; it does not authorize spending.
