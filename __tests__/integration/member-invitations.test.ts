import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  acceptInvitation,
  createInvitation,
  createPrismaInvitationRepository,
  revokeInvitation,
} from '@/lib/members/invitations';
import {
  consumeDigestRateLimit,
  digestRateLimitKey,
} from '@/lib/security/rate-limit';
import { digestOpaqueToken } from '@/lib/security/tokens';

import { withMigratedPostgres, withPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

async function provisionAppClient(admin: PrismaClient, databaseUrl: string) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
  const client = new PrismaClient({
    datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
  });
  await client.$connect();
  return client;
}

async function seedWorkspace(
  admin: PrismaClient,
  tenantId: string,
  users: Array<{ id: string; email: string; role: 'OWNER' | 'MEMBER' }>,
) {
  await admin.tenant.create({
    data: {
      id: tenantId,
      name: `${tenantId} Kitchen`,
      addressLine: '1 Market Road',
      city: 'Pune',
      state: 'Maharashtra',
      pin: '411001',
      phone: '9000000000',
      users: {
        create: users.map((user) => ({
          ...user,
          name: user.id,
          isActive: true,
        })),
      },
    },
  });
}

const start = new Date('2026-08-28T10:00:00.000Z');

test('restricted runtime invitations are owner-controlled, one-time, tenant-safe, and atomic', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      await seedWorkspace(admin, 'tenant-a', [
        { id: 'owner-a', email: 'owner-a@example.test', role: 'OWNER' },
        { id: 'member-a', email: 'member-a@example.test', role: 'MEMBER' },
      ]);
      await seedWorkspace(admin, 'tenant-b', [
        { id: 'owner-b', email: 'owner-b@example.test', role: 'OWNER' },
      ]);
      app = await provisionAppClient(admin, databaseUrl);
      const repository = createPrismaInvitationRepository(app);

      const rateLimitSubject = 'b'.repeat(64);
      const rateLimitResults = await Promise.all(
        Array.from({ length: 6 }, () =>
          consumeDigestRateLimit(
            {
              scope: 'member-invitation-accept',
              subjectDigest: rateLimitSubject,
              limit: 5,
              windowMs: 15 * 60 * 1_000,
              now: start,
            },
            app,
          ),
        ),
      );
      expect(rateLimitResults.filter(({ allowed }) => allowed)).toHaveLength(5);
      expect(rateLimitResults.filter(({ allowed }) => !allowed)).toHaveLength(1);
      const storedBucket = await admin.rateLimitBucket.findUniqueOrThrow({
        where: {
          keyDigest: digestRateLimitKey(
            'member-invitation-accept',
            rateLimitSubject,
          ),
        },
      });
      expect(storedBucket.count).toBe(6);
      expect(JSON.stringify(storedBucket)).not.toContain(rateLimitSubject);

      const functions = await admin.$queryRaw<
        Array<{
          name: string;
          owner: string;
          securityDefiner: boolean;
          settings: string[];
          appCanExecute: boolean;
          publicCanExecute: boolean;
        }>
      >`
        SELECT
          procedure.proname AS name,
          owner.rolname AS owner,
          procedure.prosecdef AS "securityDefiner",
          procedure.proconfig AS settings,
          has_function_privilege('autorfp_app', procedure.oid, 'EXECUTE')
            AS "appCanExecute",
          EXISTS (
            SELECT 1
            FROM aclexplode(
              COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
            ) AS permission
            WHERE permission.grantee = 0
              AND permission.privilege_type = 'EXECUTE'
          ) AS "publicCanExecute"
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        JOIN pg_roles AS owner ON owner.oid = procedure.proowner
        WHERE namespace.nspname = 'autorfp_private'
          AND procedure.proname IN (
            'autorfp_invitation_tenant_by_digest',
            'autorfp_user_email_exists'
          )
        ORDER BY procedure.proname
      `;
      expect(functions).toEqual([
        {
          name: 'autorfp_invitation_tenant_by_digest',
          owner: 'autorfp',
          securityDefiner: true,
          settings: ['search_path=pg_catalog'],
          appCanExecute: true,
          publicCanExecute: false,
        },
        {
          name: 'autorfp_user_email_exists',
          owner: 'autorfp',
          securityDefiner: true,
          settings: ['search_path=pg_catalog'],
          appCanExecute: true,
          publicCanExecute: false,
        },
      ]);
      const [digestFunction] = await admin.$queryRaw<Array<{ source: string }>>`
        SELECT pg_get_functiondef(procedure.oid) AS source
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'autorfp_private'
          AND procedure.proname = 'autorfp_invitation_tenant_by_digest'
      `;
      expect(digestFunction.source).toContain(
        'invitation."tokenDigest" = lookup_digest::CHAR(64)',
      );
      await expect(
        app.$queryRaw`
          SELECT *
          FROM autorfp_private.autorfp_invitation_tenant_by_digest(${'a'.repeat(65)})
        `,
      ).resolves.toEqual([]);

      for (const actor of [
        { userId: 'member-a', tenantId: 'tenant-a' },
        { userId: 'owner-b', tenantId: 'tenant-a' },
      ]) {
        await expect(
          createInvitation(
            { actor, email: 'denied@example.test', role: 'MEMBER' },
            repository,
            start,
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      }
      expect(await admin.invitation.count()).toBe(0);

      for (const existingEmail of [
        'member-a@example.test',
        'owner-b@example.test',
      ]) {
        await expect(
          createInvitation(
            {
              actor: { userId: 'owner-a', tenantId: 'tenant-a' },
              email: existingEmail,
              role: 'MEMBER',
            },
            repository,
            start,
          ),
        ).rejects.toMatchObject({
          code: 'EMAIL_UNAVAILABLE',
          status: 409,
          message: 'This email cannot be invited.',
        });
      }
      expect(await admin.invitation.count()).toBe(0);

      const first = await createInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          email: 'replace@example.test',
          role: 'MEMBER',
        },
        repository,
        start,
      );
      const replacement = await createInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          email: ' REPLACE@EXAMPLE.TEST ',
          role: 'OWNER',
        },
        repository,
        new Date(start.getTime() + 1_000),
      );
      expect(first.token).not.toBe(replacement.token);
      expect(
        await admin.invitation.findUnique({ where: { id: first.id } }),
      ).toEqual(expect.objectContaining({ revokedAt: new Date(start.getTime() + 1_000) }));
      const storedReplacement = await admin.invitation.findUniqueOrThrow({
        where: { id: replacement.id },
      });
      expect(storedReplacement).toEqual(
        expect.objectContaining({
          tenantId: 'tenant-a',
          email: 'replace@example.test',
          role: 'OWNER',
          tokenDigest: digestOpaqueToken('member-invitation', replacement.token),
          expiresAt: new Date('2026-09-04T10:00:01.000Z'),
        }),
      );
      expect(JSON.stringify(storedReplacement)).not.toContain(replacement.token);
      const indexPlan = await admin.$transaction(async (transaction) => {
        await transaction.$executeRaw`SET LOCAL enable_seqscan = off`;
        return transaction.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>`
          EXPLAIN (FORMAT JSON, COSTS OFF)
          SELECT "tenantId"
          FROM "Invitation"
          WHERE "tokenDigest" = ${storedReplacement.tokenDigest}::CHAR(64)
        `;
      });
      expect(JSON.stringify(indexPlan)).toContain('Invitation_tokenDigest_key');
      await expect(app.invitation.findMany()).resolves.toEqual([]);

      await expect(
        acceptInvitation(
          {
            token: replacement.token,
            email: 'other@example.test',
            name: 'Wrong Email',
            password: 'password-1',
          },
          repository,
          new Date(start.getTime() + 2_000),
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE', status: 410 });

      const accepted = await acceptInvitation(
        {
          token: replacement.token,
          email: ' REPLACE@EXAMPLE.TEST ',
          name: '  Priya Shah  ',
          password: 'correct horse battery staple',
        },
        repository,
        new Date(start.getTime() + 2_000),
      );
      const joined = await admin.user.findUniqueOrThrow({
        where: { id: accepted.userId },
      });
      expect(joined).toEqual(
        expect.objectContaining({
          tenantId: 'tenant-a',
          email: 'replace@example.test',
          name: 'Priya Shah',
          role: 'OWNER',
          passwordHash: expect.stringMatching(/^\$argon2id\$/),
        }),
      );
      expect(
        await admin.invitation.findUnique({ where: { id: replacement.id } }),
      ).toEqual(expect.objectContaining({ acceptedAt: expect.any(Date) }));
      await expect(
        acceptInvitation(
          {
            token: replacement.token,
            email: 'replace@example.test',
            name: 'Replay',
            password: 'password-1',
          },
          repository,
          new Date(start.getTime() + 3_000),
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE', status: 410 });

      const [{ databaseNow }] = await admin.$queryRaw<Array<{ databaseNow: Date }>>`
        SELECT statement_timestamp() AS "databaseNow"
      `;
      const expiryDuringHash = await createInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          email: 'hash-expiry@example.test',
          role: 'MEMBER',
        },
        repository,
        databaseNow,
      );
      const expiresBeforeLockedAccept: typeof repository = {
        ...repository,
        async consumeAcceptanceAttempt(input) {
          const result = await repository.consumeAcceptanceAttempt(input);
          await admin.$executeRaw`
            UPDATE "Invitation"
            SET "expiresAt" = statement_timestamp() - INTERVAL '1 millisecond'
            WHERE "id" = ${expiryDuringHash.id}
          `;
          return result;
        },
      };
      await expect(
        acceptInvitation(
          {
            token: expiryDuringHash.token,
            email: 'hash-expiry@example.test',
            name: 'Expired During Hash',
            password: 'password-1',
          },
          expiresBeforeLockedAccept,
          new Date(databaseNow.getTime() - 24 * 60 * 60 * 1_000),
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE', status: 410 });
      expect(
        await admin.invitation.findUnique({ where: { id: expiryDuringHash.id } }),
      ).toEqual(expect.objectContaining({ acceptedAt: null }));
      expect(
        await admin.user.count({ where: { email: 'hash-expiry@example.test' } }),
      ).toBe(0);

      const tenantARace = await createInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          email: 'cross-tenant-race@example.test',
          role: 'MEMBER',
        },
        repository,
        databaseNow,
      );
      const tenantBRace = await createInvitation(
        {
          actor: { userId: 'owner-b', tenantId: 'tenant-b' },
          email: 'cross-tenant-race@example.test',
          role: 'MEMBER',
        },
        repository,
        databaseNow,
      );
      const crossTenantResults = await Promise.allSettled(
        [tenantARace, tenantBRace].map((invitation, index) =>
          acceptInvitation(
            {
              token: invitation.token,
              email: 'cross-tenant-race@example.test',
              name: `Cross Tenant ${index + 1}`,
              password: 'password-1',
            },
            repository,
            databaseNow,
          ),
        ),
      );
      expect(
        crossTenantResults.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        crossTenantResults.map((result) =>
          result.status === 'fulfilled'
            ? { status: 'fulfilled' }
            : {
                status: 'rejected',
                code: result.reason?.code,
                httpStatus: result.reason?.status,
                message: result.reason?.message,
                meta: result.reason?.meta,
              },
        ),
      ).toEqual(
        expect.arrayContaining([
          { status: 'fulfilled' },
          expect.objectContaining({
            status: 'rejected',
            code: 'EMAIL_UNAVAILABLE',
            httpStatus: 409,
          }),
        ]),
      );
      expect(
        await admin.user.count({
          where: { email: 'cross-tenant-race@example.test' },
        }),
      ).toBe(1);

      const revoked = await createInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          email: 'revoked@example.test',
          role: 'MEMBER',
        },
        repository,
        start,
      );
      await expect(
        revokeInvitation(
          {
            actor: { userId: 'member-a', tenantId: 'tenant-a' },
            invitationId: revoked.id,
          },
          repository,
          new Date(start.getTime() + 1_000),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await revokeInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          invitationId: revoked.id,
        },
        repository,
        new Date(start.getTime() + 1_000),
      );
      await expect(
        acceptInvitation(
          {
            token: revoked.token,
            email: 'revoked@example.test',
            name: 'Revoked',
            password: 'password-1',
          },
          repository,
          new Date(start.getTime() + 2_000),
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE', status: 410 });

      const expired = await createInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          email: 'expired@example.test',
          role: 'MEMBER',
        },
        repository,
        start,
      );
      await admin.$executeRaw`
        UPDATE "Invitation"
        SET "expiresAt" = statement_timestamp() - INTERVAL '1 millisecond'
        WHERE "id" = ${expired.id}
      `;
      await expect(
        acceptInvitation(
          {
            token: expired.token,
            email: 'expired@example.test',
            name: 'Expired',
            password: 'password-1',
          },
          repository,
          new Date('2026-09-04T10:00:00.000Z'),
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE', status: 410 });

      const raced = await createInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          email: 'race@example.test',
          role: 'MEMBER',
        },
        repository,
        start,
      );
      const raceResults = await Promise.allSettled(
        ['Race One', 'Race Two'].map((name) =>
          acceptInvitation(
            {
              token: raced.token,
              email: 'race@example.test',
              name,
              password: 'password-1',
            },
            repository,
            new Date(start.getTime() + 1_000),
          ),
        ),
      );
      expect(raceResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(
        raceResults.filter(
          (result) =>
            result.status === 'rejected' &&
            result.reason?.code === 'INVITATION_UNAVAILABLE',
        ),
      ).toHaveLength(1);
      expect(await admin.user.count({ where: { email: 'race@example.test' } })).toBe(1);

      const rollback = await createInvitation(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          email: 'rollback@example.test',
          role: 'MEMBER',
        },
        repository,
        start,
      );
      await admin.$executeRawUnsafe(`
        CREATE FUNCTION public.fail_member_joined_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'member.joined' THEN
            RAISE EXCEPTION 'audit unavailable';
          END IF;
          RETURN NEW;
        END
        $$
      `);
      await admin.$executeRawUnsafe(`
        CREATE TRIGGER fail_member_joined_audit
        BEFORE INSERT ON public."AuditEvent"
        FOR EACH ROW EXECUTE FUNCTION public.fail_member_joined_audit();
      `);
      await expect(
        acceptInvitation(
          {
            token: rollback.token,
            email: 'rollback@example.test',
            name: 'Rollback User',
            password: 'password-1',
          },
          repository,
          new Date(start.getTime() + 1_000),
        ),
      ).rejects.toThrow('audit unavailable');
      expect(await admin.user.count({ where: { email: 'rollback@example.test' } })).toBe(0);
      expect(
        await admin.invitation.findUnique({ where: { id: rollback.id } }),
      ).toEqual(expect.objectContaining({ acceptedAt: null }));

      const audit = await admin.auditEvent.findMany({
        where: { tenantId: 'tenant-a' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'member.invitation-revoked',
            entityType: 'Invitation',
            entityId: first.id,
          }),
          expect.objectContaining({
            action: 'member.invited',
            entityType: 'Invitation',
            metadata: { role: 'OWNER' },
          }),
          expect.objectContaining({
            action: 'member.joined',
            entityType: 'User',
            actorUserId: accepted.userId,
            metadata: { role: 'OWNER' },
          }),
          expect.objectContaining({
            action: 'member.invitation-revoked',
            entityType: 'Invitation',
            entityId: revoked.id,
          }),
        ]),
      );
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});

test('invitation migration accepts a capable Neon-shaped object owner', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    await migrateTo('20260827000300_forced_rls');
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await admin.$executeRawUnsafe(
        'CREATE ROLE neon_launch_owner NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOLOGIN',
      );
      await admin.$executeRawUnsafe(
        'ALTER SCHEMA autorfp_private OWNER TO neon_launch_owner',
      );
      await admin.$executeRawUnsafe(
        'ALTER TABLE public."Invitation" OWNER TO neon_launch_owner',
      );
      await admin.$executeRawUnsafe(
        'ALTER TABLE public."User" OWNER TO neon_launch_owner',
      );
      await admin.$executeRawUnsafe(
        'ALTER TABLE public."Tenant" OWNER TO neon_launch_owner',
      );
      const migration = readFileSync(
        path.resolve(
          __dirname,
          '../../prisma/migrations/20260827000400_member_invitations/migration.sql',
        ),
        'utf8',
      );
      const ownerCheck = migration.slice(
        migration.indexOf('DO $migration_owner$'),
        migration.indexOf('$migration_owner$;') + '$migration_owner$;'.length,
      );

      await expect(
        admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe('SET LOCAL ROLE neon_launch_owner');
          await transaction.$executeRawUnsafe(ownerCheck);
        }),
      ).resolves.toBeUndefined();
    } finally {
      await admin.$disconnect();
    }
  });
});
