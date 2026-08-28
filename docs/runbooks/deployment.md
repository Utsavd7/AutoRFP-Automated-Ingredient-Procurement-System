# Deployment runbook

QuotePlate production is Netlify Free only. Repository-linked deploy previews may run for review, but an automatic production Git build is blocked by `netlify.toml`. Production publishing is available only through the manually dispatched GitHub workflow and the protected **GitHub production environment**.

## One-time setup

1. Create a cardless Netlify Free site and confirm the account has no payment method, auto-recharge, paid overage, or paid add-on.
2. Disable repository-driven production publishing. Keep deploy previews only if the free-credit budget allows them.
3. Configure Google OAuth with the exact authorized redirect URI `${NEXTAUTH_URL}/api/auth/callback/google` (for example, `https://quoteplate.example/api/auth/callback/google`). Production pilot activation requires both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; it is not an optional launch path. The verified Google email must exactly match one of the addresses in `QUOTEPLATE_PILOT_EMAILS`.
4. Create a GitHub environment named `production`, require an operator reviewer, prevent self-review where available, and restrict it to `main`.
5. Store `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, and the **migration-only owner secret** `NEON_DIRECT_DATABASE_URL` only as secrets of that GitHub environment. Set a non-empty HTTPS `PRODUCTION_URL` as an environment variable. Never put the owner connection in Netlify or any running application environment; the workflow maps it to Prisma variables for the migration step only.
6. Confirm Neon uses its Free plan, pooled runtime endpoint, smallest compute, and five-minute scale-to-zero. Migrations use the direct endpoint.

## One-time runtime-role password bootstrap

Do this once before the first site publish. Confirm the chosen commit is on `main` with successful CI, then manually dispatch **Bootstrap QuotePlate production database** with that full SHA and type `BOOTSTRAP_QUOTEPLATE_DATABASE_ONLY`. Approve the protected production environment. This workflow applies migrations and cannot call Netlify or publish a site.

The first production migration creates `autorfp_app` directly in SQL with restricted attributes and intentionally does not embed a password. Do not create this role in the Neon Console, CLI, or API: provider-created roles can belong to `neon_superuser`, and the migration and application intentionally reject any runtime role with privileged membership. After the database-only workflow succeeds, connect interactively as the Neon owner without putting either password in the command line. Use non-secret host and user values in the connection options and let `psql` prompt for the owner password:

```sh
psql "host=YOUR_DIRECT_NEON_HOST dbname=neondb user=YOUR_NEON_OWNER sslmode=require"
```

At the `psql` prompt, run:

```text
\password autorfp_app
```

Enter a new random password twice at the hidden prompts, then use `\q`. The runtime password never appears in shell history, SQL history, process arguments, or the migration files. Do not use `ALTER ROLE ... PASSWORD '...'`, `PGPASSWORD`, or a URL containing the password on the command line.

Store that password only in the Netlify production secret for the restricted, pooled `DATABASE_URL` (`autorfp_app` plus the `-pooler` host). Add the runtime values `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `QUOTEPLATE_PILOT_EMAILS` (one to four comma-separated, approved owner emails that exactly match their verified Google identities). Set `QUOTEPLATE_RUNTIME_STARTUP_CHECK=1` in the production Functions/runtime scope, not the Build scope. A secret-free public build must remain possible. The direct owner credential remains migration-only and is never used by the running application.

Do not dispatch the site deployment until the database-only workflow, interactive password step, pooled `DATABASE_URL`, Google credentials, and pilot allowlist are all complete. This prevents spending a free-tier production publish on a guaranteed failed canary.

## Release

1. Confirm CI is green on the full 40-character commit SHA and the preview has been reviewed. The workflow independently proves that the SHA is reachable from `main` and that the `CI` workflow has a successful `push` run for that exact SHA.
2. Recheck the [cost boundary](cost-boundaries.md). Stop if any provider requests a card, billing link, auto-recharge, paid overage, or upgrade.
3. Dispatch **Deploy approved release to Netlify** with that SHA and type `DEPLOY_QUOTEPLATE_FREE_ONLY`.
4. Approve the protected `production` environment review.
5. The workflow checks out the exact SHA, verifies main and CI, applies pending migrations with the step-only owner credential, publishes once, and always runs the canary against the required production URL.
6. Record the SHA, Netlify deploy ID, operator, time, and canary result in the release notes.

Never rerun a production deploy only to investigate a failure: each publish consumes Free-plan credits. Diagnose first, then dispatch one approved correction.
