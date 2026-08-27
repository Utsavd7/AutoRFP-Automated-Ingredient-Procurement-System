# AutoRFP Phase 1 Identity and Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom one-user tenant login with invite-only user accounts, fixed organization roles, and database-enforced organization isolation.

**Architecture:** Better Auth owns users, sessions, organizations, memberships, invitations, TOTP, recovery codes, and database-backed auth rate limits. The application derives the active organization from the session plus membership. Every tenant operation runs inside one Prisma transaction that sets a transaction-local PostgreSQL organization variable; forced RLS denies unscoped access. Audit and outbox rows commit with business mutations.

**Tech Stack:** Better Auth, `@node-rs/argon2`, Prisma/PostgreSQL, Zod, Testcontainers, Jest.

---

## Simplicity boundary

Implement only three fixed roles: `owner`, `procurement_manager`, and `viewer`. Do not build custom permissions, SSO, SCIM, a platform-admin UI, multiple database abstractions, or a generic repository layer. Keep Prisma and one explicit `withOrganization()` transaction helper.

## File map

Create:

- `src/lib/auth/server.ts`
- `src/lib/auth/client.ts`
- `src/lib/auth/password.ts`
- `src/lib/auth/permissions.ts`
- `src/lib/auth/organization-context.ts`
- `src/lib/db/base-prisma.ts`
- `src/lib/db/with-organization.ts`
- `src/lib/audit/write-audit-event.ts`
- `src/lib/outbox/write-outbox-event.ts`
- `src/app/api/auth/[...all]/route.ts`
- `src/app/api/invitations/activate/route.ts`
- `prisma/migrations/*_identity_tenancy/migration.sql`
- `prisma/rls.sql`
- `jest.integration.config.cjs`
- `__tests__/integration/setup/postgres.ts`
- `__tests__/integration/rls.test.ts`
- `__tests__/integration/auth-membership.test.ts`
- `__tests__/auth/permissions.test.ts`
- `__tests__/db/with-organization.test.ts`

Delete after migration:

- `src/lib/password.ts`
- `src/lib/tenant-context.ts`
- `src/types/next-auth.d.ts`
- `src/app/api/auth/[...nextauth]/route.ts`

Modify: `package.json`, `package-lock.json`, `prisma/schema.prisma`, `.env.sample`, auth pages/components, `src/lib/server-account.ts`, `src/lib/prisma.ts`, and every authenticated API route.

## Task 1: Add real PostgreSQL integration-test infrastructure

- [ ] Add `@testcontainers/postgresql` as a dev dependency and scripts `test:unit` and `test:integration`; keep `npm test` running both suites serially.
- [ ] Create `jest.integration.config.cjs` with the existing alias mapping, Node environment, and `__tests__/integration` roots.
- [ ] Create a PostgreSQL lifecycle helper that starts one pinned PostgreSQL container per suite, sets `DATABASE_URL`, applies migrations, and always stops the container.
- [ ] Write a failing smoke test that executes `select current_database()` through the application Prisma client.
- [ ] Run `npm run test:integration -- --runTestsByPath __tests__/integration/postgres-smoke.test.ts`.

Expected: FAIL before the helper exists, then PASS against real PostgreSQL.

- [ ] Commit with `git commit -am "test: add PostgreSQL integration harness"` after staging new files.

## Task 2: Generate and configure Better Auth without custom auth machinery

- [ ] Install `better-auth`, `@node-rs/argon2`, and `zod`; remove `next-auth` only after the replacement routes and pages compile.
- [ ] Add `src/lib/auth/password.ts` with Argon2id hashing and verification. Benchmark once on the target ARM64 host later; initially set memory to 64 MiB, iterations to 3, parallelism to 1, and enforce 12–128 character passwords.
- [ ] Write unit tests for password bounds, valid verification, invalid verification, and non-equal hashes for the same password.
- [ ] Run the focused test and confirm it fails before implementation, then passes.
- [ ] Configure Better Auth in `src/lib/auth/server.ts` with Prisma, organization and two-factor plugins, secure cookies in production, seven-day absolute session age, 24-hour inactivity refresh, database rate limiting, and generic credential errors.
- [ ] Generate Better Auth's Prisma models using its installed CLI, review the diff, then add only application-required fields. Do not hand-invent duplicate user/session tables.
- [ ] Add the Better Auth catch-all route at `src/app/api/auth/[...all]/route.ts` and the matching browser client.
- [ ] Commit with `git commit -m "feat: add Better Auth organizations and two-factor support"`.

## Task 3: Migrate the legacy tenant into explicit organizations and memberships

- [ ] Update `prisma/schema.prisma`: make organization ownership non-null on `Menu`, `RFP`, `ProcurementRun`, `Distributor`/future `Supplier`, and every indirectly owned child reachable without a parent filter.
- [ ] Add fixed `Location`, `AuditEvent`, and `OutboxEvent` models. Add non-null `organizationId`, timestamps, and indexes; use UUID defaults until Phase 2 introduces UUIDv7 generation in application code.
- [ ] Generate a migration with `npx prisma migrate dev --name identity_tenancy --create-only`.
- [ ] Edit the SQL migration to create one explicit development demo organization, migrate existing `Tenant` rows and references deterministically, fail if any production-like orphan remains, and then add non-null constraints.
- [ ] Preserve existing data in a migration backup table until the migration verification query passes; drop that temporary table in the same migration only after counts match.
- [ ] Add an integration test that seeds the old shape, applies the migration, and proves row counts and ownership survived.
- [ ] Run `npm run test:integration -- --runTestsByPath __tests__/integration/identity-migration.test.ts`.

Expected: PASS with zero null organization IDs.

- [ ] Commit with `git commit -m "feat: migrate tenants to organizations and memberships"`.

## Task 4: Enforce organization isolation with PostgreSQL RLS

- [ ] Add SQL creating `autorfp_app` without `BYPASSRLS`, plus policies for `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on every organization-owned table.
- [ ] Policies must compare `organization_id` to `current_setting('app.organization_id', true)::uuid`; missing or malformed context must deny access.
- [ ] Force RLS and include `WITH CHECK` so inserts and ownership-changing updates cannot cross organizations.
- [ ] Add `prisma/rls.sql` as the reviewed policy source and invoke it from the migration; do not create a second policy generator.
- [ ] Write tests using the real `autorfp_app` role for unscoped denial, own-row CRUD, foreign-row CRUD denial, counts, joins, and attempted ownership changes.
- [ ] Run `npm run test:integration -- --runTestsByPath __tests__/integration/rls.test.ts`.

Expected: PASS for every CRUD matrix row.

- [ ] Commit with `git commit -m "feat: enforce organization isolation with PostgreSQL RLS"`.

## Task 5: Add one organization-scoped transaction helper

- [ ] Replace the AsyncLocalStorage Prisma extension with a plain base Prisma singleton in `src/lib/db/base-prisma.ts`.
- [ ] Write failing tests for `withOrganization(organizationId, callback)`: it sets context with `set_config(..., true)`, exposes a transaction client only inside the callback, rolls back on error, and does not leak context into the next transaction.
- [ ] Implement the helper using interactive Prisma transactions. Reject non-UUID organization IDs before opening a transaction.
- [ ] Add `getOrganizationContext()` that reads the Better Auth session, active organization, and membership; it never accepts organization ID from the browser.
- [ ] Change `requireApiTenant()` to return `{ user, organization, membership }` while preserving its existing 401 behavior.
- [ ] Run unit and integration tests for the helper.

Expected: PASS; an unscoped base-client tenant query fails under the app role.

- [ ] Commit with `git commit -m "refactor: centralize organization-scoped database transactions"`.

## Task 6: Enforce the three fixed application roles

- [ ] Define the explicit action matrix in `src/lib/auth/permissions.ts`; keep it as a typed constant plus `can(role, action)` function.
- [ ] Write table-driven tests proving Owner, Procurement Manager, and Viewer permissions from the specification.
- [ ] Add `requireAction(action)` that combines session, membership, and authorization checks and returns generic 401/403 problem responses.
- [ ] Replace every authenticated route's temporary guard with `requireAction` and `withOrganization`. Remove all remaining direct `tenantId`/`organizationId` request handling.
- [ ] Add route tests for a viewer mutation, a manager member-management attempt, an absent session, and a valid manager procurement read.
- [ ] Run `rg -n "tenantId|organizationId" src/app/api` and review every match; request-derived authoritative IDs are forbidden.
- [ ] Commit with `git commit -m "feat: enforce fixed organization roles on API routes"`.

## Task 7: Make account creation invite-only and require owner TOTP

- [ ] Remove public workspace signup behavior and localStorage account authority. The browser may cache display preferences only.
- [ ] Add an activation route accepting a one-time invitation token, password, and TOTP enrollment completion. Store only hashed invitation/recovery material.
- [ ] Add login, invitation activation, TOTP challenge, and logout screens using Better Auth's normal client APIs; do not build a second session protocol.
- [ ] Require owners to complete TOTP before accessing business routes. A manager/viewer may enable TOTP but launch does not require it.
- [ ] Add tests for expired invitation, reused invitation, generic unknown-email response, owner without TOTP, password change revoking other sessions, and successful activation.
- [ ] Delete old NextAuth routes, SHA password helpers, tenant context, and NextAuth type augmentation.
- [ ] Commit with `git commit -m "feat: add invite-only activation and owner two-factor login"`.

## Task 8: Make audit and outbox writes atomic

- [ ] Add small helpers that accept the existing organization transaction client; they must not open nested transactions.
- [ ] Write an integration test where a business mutation plus audit/outbox succeeds and another where a thrown error rolls all three rows back.
- [ ] Add audit events to membership/role changes and outbox events to actions later consumed asynchronously. Store safe identifiers and correlation IDs, never secrets or raw request bodies.
- [ ] Add a unique `(organizationId, idempotencyKey, eventType)` constraint for outbox events.
- [ ] Run the atomicity test. Expected: PASS with matching commit/rollback counts.
- [ ] Commit with `git commit -m "feat: commit audit and outbox records atomically"`.

## Task 9: Prove the Phase 1 exit gate

- [ ] Run the full cross-organization CRUD suite as `autorfp_app`.
- [ ] Run auth journey tests for activation, TOTP, fixed roles, session revocation, and enumeration-safe errors.
- [ ] Run `rg -n "next-auth|createPasswordRecord|passwordSalt|tenant_demo|getCurrentTenantId|withTenantContext" src prisma package.json`.

Expected: no runtime matches.

- [ ] Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.

Expected: all exit `0`.

- [ ] Commit verification-only fixes with `git commit -m "test: verify identity and tenant isolation gate"`.

## Phase 1 exit gate

- [ ] All internal routes derive organization context from a valid membership.
- [ ] PostgreSQL forced RLS denies every tested cross-organization read and write.
- [ ] Owner activation, TOTP, session expiry/revocation, and the three fixed roles work.
- [ ] Audit/outbox rows are atomic with the state change.
- [ ] No custom SHA auth, client-authoritative tenant state, or dormant isolation interceptor remains.
