import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  acceptInvitation,
  createInvitation,
  createPrismaInvitationRepository,
  revokeInvitation,
} from '@/lib/members/invitations';
import { createPasswordRecord } from '@/lib/password';
import { digestOpaqueToken } from '@/lib/security/tokens';

import { withMigratedPostgres } from './setup/postgres';

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
  ownerId: string,
  email: string,
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
        create: {
          id: ownerId,
          name: ownerId,
          email,
          role: 'OWNER',
          accountState: 'ACTIVE',
          isActive: true,
        },
      },
    },
  });
}

const ownerA = { userId: 'owner-a', tenantId: 'tenant-a' };
const ownerB = { userId: 'owner-b', tenantId: 'tenant-b' };
const forbiddenActors = [
  { userId: 'member-a', tenantId: 'tenant-a' },
  { userId: 'owner-b', tenantId: 'tenant-a' },
] as const;

test('compact invitations use one tenant-safe User lifecycle atomically', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      await seedWorkspace(
        admin,
        'tenant-a',
        'owner-a',
        'owner-a@example.test',
      );
      await seedWorkspace(
        admin,
        'tenant-b',
        'owner-b',
        'owner-b@example.test',
      );
      await admin.user.create({
        data: {
          id: 'member-a',
          tenantId: 'tenant-a',
          name: 'Member A',
          email: 'member-a@example.test',
          role: 'MEMBER',
          accountState: 'ACTIVE',
          isActive: true,
        },
      });
      app = await provisionAppClient(admin, databaseUrl);
      const repository = createPrismaInvitationRepository(app);
      const [{ databaseNow: start }] = await admin.$queryRaw<
        Array<{ databaseNow: Date }>
      >`SELECT statement_timestamp() AS "databaseNow"`;
      const expectedExpiry = new Date(
        start.getTime() + 7 * 24 * 60 * 60 * 1_000,
      );

      const functions = await admin.$queryRaw<
        Array<{
          name: string;
          securityDefiner: boolean;
          settings: string[];
          appCanExecute: boolean;
          publicCanExecute: boolean;
        }>
      >`
        SELECT
          procedure.proname AS name,
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
          securityDefiner: true,
          settings: ['search_path=pg_catalog'],
          appCanExecute: true,
          publicCanExecute: false,
        },
        {
          name: 'autorfp_user_email_exists',
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
        'account."invitationTokenDigest" = lookup_digest::CHAR(64)',
      );
      expect(digestFunction.source).toContain('account."isActive" = false');

      for (const actor of forbiddenActors) {
        await expect(
          createInvitation(
            {
              actor,
              email: `forbidden-${actor.userId}@example.test`,
              role: 'MEMBER',
            },
            repository,
            start,
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      }

      const invited = await createInvitation(
        { actor: ownerA, email: ' MEMBER@EXAMPLE.TEST ', role: 'MEMBER' },
        repository,
        start,
      );
      const digest = digestOpaqueToken('member-invitation', invited.token);
      const invitedRow = await admin.user.findUniqueOrThrow({
        where: { id: invited.id },
      });
      expect(invitedRow).toMatchObject({
        tenantId: 'tenant-a',
        email: 'member@example.test',
        role: 'MEMBER',
        accountState: 'INVITED',
        isActive: false,
        passwordHash: null,
        invitationTokenDigest: digest,
        invitationExpiresAt: expectedExpiry,
        invitationAcceptedAt: null,
        invitationRevokedAt: null,
        invitedByUserId: 'owner-a',
      });
      await expect(
        app.$queryRaw`
          SELECT *
          FROM autorfp_private.autorfp_invitation_tenant_by_digest(${digest})
        `,
      ).resolves.toEqual([{ tenantId: 'tenant-a' }]);
      await expect(app.user.findMany()).resolves.toEqual([]);

      const impostorDigest = 'f'.repeat(64);
      await admin.user.create({
        data: {
          id: 'active-impostor',
          tenantId: 'tenant-a',
          name: 'Active impostor',
          email: 'active-impostor@example.test',
          accountState: 'INVITED',
          isActive: true,
          invitationTokenDigest: impostorDigest,
          invitationExpiresAt: expectedExpiry,
          invitedByUserId: 'owner-a',
        },
      });
      await expect(
        app.$queryRaw`
          SELECT *
          FROM autorfp_private.autorfp_invitation_tenant_by_digest(
            ${impostorDigest}
          )
        `,
      ).resolves.toEqual([]);

      const accepted = await acceptInvitation(
        {
          token: invited.token,
          email: 'member@example.test',
          name: '  Priya Shah  ',
          password: 'correct horse battery staple',
        },
        repository,
        new Date(start.getTime() + 1_000),
      );
      expect(accepted).toEqual({ userId: invited.id, tenantId: 'tenant-a' });
      const acceptedRow = await admin.user.findUniqueOrThrow({
        where: { id: invited.id },
      });
      expect(acceptedRow).toMatchObject({
        id: invited.id,
        name: 'Priya Shah',
        accountState: 'ACTIVE',
        isActive: true,
        passwordHash: expect.stringMatching(/^\$argon2id\$/),
        invitationTokenDigest: null,
        invitationAcceptedAt: expect.any(Date),
      });
      await expect(
        acceptInvitation(
          {
            token: invited.token,
            email: 'member@example.test',
            name: 'Replay',
            password: 'password-1',
          },
          repository,
          new Date(start.getTime() + 2_000),
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE', status: 410 });

      const concurrent = await createInvitation(
        { actor: ownerA, email: 'concurrent@example.test', role: 'MEMBER' },
        repository,
        start,
      );
      const concurrentAttempts = await Promise.allSettled([
        acceptInvitation(
          {
            token: concurrent.token,
            email: 'concurrent@example.test',
            name: 'Concurrent One',
            password: 'password-1',
          },
          repository,
          new Date(start.getTime() + 1_000),
        ),
        acceptInvitation(
          {
            token: concurrent.token,
            email: 'concurrent@example.test',
            name: 'Concurrent Two',
            password: 'password-2',
          },
          repository,
          new Date(start.getTime() + 1_000),
        ),
      ]);
      expect(concurrentAttempts.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const concurrentFailure = concurrentAttempts.find(
        (attempt) => attempt.status === 'rejected',
      );
      expect(concurrentFailure).toMatchObject({
        reason: { code: 'INVITATION_UNAVAILABLE', status: 410 },
      });
      expect(
        await admin.user.findUniqueOrThrow({ where: { id: concurrent.id } }),
      ).toMatchObject({
        accountState: 'ACTIVE',
        isActive: true,
        invitationTokenDigest: null,
        invitationAcceptedAt: expect.any(Date),
      });

      const boundary = await createInvitation(
        { actor: ownerA, email: 'boundary@example.test', role: 'MEMBER' },
        repository,
        start,
      );
      const passwordHash = (
        await createPasswordRecord('correct horse battery staple')
      ).passwordHash;
      await expect(
        repository.accept({
          tokenDigest: digestOpaqueToken('member-invitation', boundary.token),
          tenantId: 'tenant-b',
          email: 'boundary@example.test',
          name: 'Wrong Tenant',
          passwordHash,
        }),
      ).resolves.toBeNull();
      expect(
        await admin.user.findUniqueOrThrow({ where: { id: boundary.id } }),
      ).toMatchObject({ accountState: 'INVITED', isActive: false });

      const expiredAfterResolution = await createInvitation(
        { actor: ownerA, email: 'expired-after-resolve@example.test' },
        repository,
        start,
      );
      const expiredDigest = digestOpaqueToken(
        'member-invitation',
        expiredAfterResolution.token,
      );
      await expect(
        repository.resolve({ tokenDigest: expiredDigest }),
      ).resolves.toEqual({ tenantId: 'tenant-a' });
      await admin.user.update({
        where: { id: expiredAfterResolution.id },
        data: { invitationExpiresAt: new Date(start.getTime() - 1_000) },
      });
      await expect(
        repository.accept({
          tokenDigest: expiredDigest,
          tenantId: 'tenant-a',
          email: 'expired-after-resolve@example.test',
          name: 'Too Late',
          passwordHash,
        }),
      ).resolves.toBeNull();
      expect(
        await admin.user.findUniqueOrThrow({
          where: { id: expiredAfterResolution.id },
        }),
      ).toMatchObject({ accountState: 'INVITED', isActive: false });

      await expect(
        createInvitation(
          { actor: ownerA, email: 'owner-b@example.test', role: 'MEMBER' },
          repository,
          start,
        ),
      ).rejects.toMatchObject({
        code: 'EMAIL_UNAVAILABLE',
        status: 409,
        message: 'This email cannot be invited.',
      });
      const replacement = await createInvitation(
        { actor: ownerA, email: 'boundary@example.test', role: 'OWNER' },
        repository,
        new Date(start.getTime() + 1_000),
      );
      expect(replacement.id).toBe(boundary.id);
      expect(replacement.token).not.toBe(boundary.token);
      expect(
        await admin.user.findUniqueOrThrow({ where: { id: boundary.id } }),
      ).toMatchObject({
        role: 'OWNER',
        accountState: 'INVITED',
        isActive: false,
        invitationTokenDigest: digestOpaqueToken(
          'member-invitation',
          replacement.token,
        ),
      });
      await expect(
        createInvitation(
          { actor: ownerB, email: 'boundary@example.test', role: 'MEMBER' },
          repository,
          start,
        ),
      ).rejects.toMatchObject({
        code: 'EMAIL_UNAVAILABLE',
        status: 409,
        message: 'This email cannot be invited.',
      });

      const revoked = await createInvitation(
        { actor: ownerA, email: 'revoked@example.test', role: 'OWNER' },
        repository,
        start,
      );
      for (const actor of forbiddenActors) {
        await expect(
          revokeInvitation(
            { actor, invitationId: revoked.id },
            repository,
            new Date(start.getTime() + 1_000),
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      }
      expect(
        await admin.user.findUniqueOrThrow({ where: { id: revoked.id } }),
      ).toMatchObject({
        accountState: 'INVITED',
        isActive: false,
        invitationTokenDigest: digestOpaqueToken(
          'member-invitation',
          revoked.token,
        ),
      });
      await revokeInvitation(
        { actor: ownerA, invitationId: revoked.id },
        repository,
        new Date(start.getTime() + 1_000),
      );
      expect(
        await admin.user.findUniqueOrThrow({ where: { id: revoked.id } }),
      ).toMatchObject({
        accountState: 'DEACTIVATED',
        isActive: false,
        invitationTokenDigest: null,
        invitationAcceptedAt: null,
        invitationRevokedAt: new Date(start.getTime() + 1_000),
      });

      const rollback = await createInvitation(
        { actor: ownerA, email: 'rollback@example.test', role: 'MEMBER' },
        repository,
        start,
      );
      const rollbackDigest = digestOpaqueToken(
        'member-invitation',
        rollback.token,
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
        FOR EACH ROW EXECUTE FUNCTION public.fail_member_joined_audit()
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
      expect(
        await admin.user.findUniqueOrThrow({ where: { id: rollback.id } }),
      ).toMatchObject({
        accountState: 'INVITED',
        isActive: false,
        invitationTokenDigest: rollbackDigest,
        invitationAcceptedAt: null,
      });

      expect(
        await admin.auditEvent.findMany({
          where: { tenantId: 'tenant-a' },
          orderBy: { createdAt: 'asc' },
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'member.invited',
            entityType: 'User',
            entityId: invited.id,
            metadata: { role: 'MEMBER' },
          }),
          expect.objectContaining({
            action: 'member.joined',
            entityType: 'User',
            entityId: invited.id,
          }),
          expect.objectContaining({
            action: 'member.invitation-revoked',
            entityType: 'User',
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
