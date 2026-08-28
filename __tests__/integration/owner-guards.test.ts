import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  assertCanDeactivateUser,
  AuthorizationError,
  requireOwner,
} from '@/lib/auth/guards';
import { writeAuditEvent } from '@/lib/audit/write-event';
import { withTenant } from '@/lib/db/tenant-transaction';

import { withMigratedPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

async function provisionAppClient(admin: PrismaClient, databaseUrl: string) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(
    `ALTER ROLE autorfp_app PASSWORD '${password}'`,
  );
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

test('owner guards deny members and preserve one active workspace owner', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    let app: PrismaClient | undefined;

    try {
      await seedWorkspace(admin, 'single-owner-tenant', [
        { id: 'only-owner', email: 'only-owner@example.test', role: 'OWNER' },
        { id: 'member-a', email: 'member-a@example.test', role: 'MEMBER' },
      ]);
      await seedWorkspace(admin, 'two-owner-tenant', [
        { id: 'owner-one', email: 'owner-one@example.test', role: 'OWNER' },
        { id: 'owner-two', email: 'owner-two@example.test', role: 'OWNER' },
      ]);
      await seedWorkspace(admin, 'parallel-owner-tenant', [
        { id: 'parallel-one', email: 'parallel-one@example.test', role: 'OWNER' },
        { id: 'parallel-two', email: 'parallel-two@example.test', role: 'OWNER' },
      ]);
      app = await provisionAppClient(admin, databaseUrl);

      const { owner, member } = await withTenant(
        'single-owner-tenant',
        async (tx) => {
          const rows = await tx.user.findMany({ orderBy: { id: 'asc' } });
          return {
            owner: rows.find(({ role }) => role === 'OWNER')!,
            member: rows.find(({ role }) => role === 'MEMBER')!,
          };
        },
        app,
      );

      expect(() => requireOwner(member, 'award')).toThrow(AuthorizationError);
      expect(() => requireOwner(member, 'manage-members')).toThrow(
        AuthorizationError,
      );
      expect(() => requireOwner(member, 'manage-settings')).toThrow(
        AuthorizationError,
      );
      expect(requireOwner(owner, 'award')).toBe(owner);

      await admin.user.update({
        where: { id: member.id },
        data: { role: 'MEMBER', isActive: true },
      });
      await expect(
        withTenant(
          'single-owner-tenant',
          (tx) =>
            assertCanDeactivateUser(
              tx,
              { ...member, role: 'OWNER', isActive: true },
              owner.id,
            ),
          app,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await admin.user.update({
        where: { id: member.id },
        data: { role: 'OWNER', isActive: false },
      });
      await expect(
        withTenant(
          'single-owner-tenant',
          (tx) =>
            assertCanDeactivateUser(
              tx,
              { ...member, role: 'OWNER', isActive: true },
              owner.id,
            ),
          app,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await expect(
        withTenant(
          'single-owner-tenant',
          (tx) => assertCanDeactivateUser(tx, owner, owner.id),
          app,
        ),
      ).rejects.toMatchObject({ code: 'LAST_ACTIVE_OWNER' });
      expect(
        await admin.user.findUnique({ where: { id: 'only-owner' } }),
      ).toEqual(expect.objectContaining({ isActive: true }));

      await withTenant(
        'two-owner-tenant',
        async (tx) => {
          const actor = await tx.user.findUniqueOrThrow({
            where: { id: 'owner-one' },
          });
          await assertCanDeactivateUser(tx, actor, 'owner-two');
          await tx.user.update({
            where: { id: 'owner-two' },
            data: { isActive: false },
          });
          await writeAuditEvent(tx, {
            tenantId: 'two-owner-tenant',
            actorUserId: actor.id,
            action: 'member.deactivated',
            entityId: 'owner-two',
            metadata: { previousRole: 'OWNER' },
          });
        },
        app,
      );
      expect(
        await admin.user.findUnique({ where: { id: 'owner-two' } }),
      ).toEqual(expect.objectContaining({ isActive: false }));
      expect(
        await admin.auditEvent.findMany({
          where: { tenantId: 'two-owner-tenant' },
        }),
      ).toEqual([
        expect.objectContaining({
          action: 'member.deactivated',
          entityType: 'User',
          entityId: 'owner-two',
          metadata: { previousRole: 'OWNER' },
        }),
      ]);

      const parallelDeactivations = await Promise.allSettled(
        ['parallel-one', 'parallel-two'].map((userId) =>
          withTenant(
            'parallel-owner-tenant',
            async (tx) => {
              const actor = await tx.user.findUniqueOrThrow({
                where: { id: userId },
              });
              await assertCanDeactivateUser(tx, actor, userId);
              await tx.user.update({
                where: { id: userId },
                data: { isActive: false },
              });
            },
            app!,
          ),
        ),
      );
      expect(
        parallelDeactivations.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        parallelDeactivations.filter(
          (result) =>
            result.status === 'rejected' &&
            result.reason?.code === 'LAST_ACTIVE_OWNER',
        ),
      ).toHaveLength(1);
      expect(
        await admin.user.count({
          where: {
            tenantId: 'parallel-owner-tenant',
            role: 'OWNER',
            isActive: true,
          },
        }),
      ).toBe(1);

      await expect(
        withTenant(
          'single-owner-tenant',
          (tx) =>
            writeAuditEvent(tx, {
              tenantId: 'single-owner-tenant',
              actorUserId: owner.id,
              action: 'request.awarded',
              entityId: 'award-a',
              metadata: { token: 'must-not-enter-audit-history' },
            }),
          app,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_AUDIT_METADATA' });

      await expect(
        withTenant(
          'single-owner-tenant',
          (tx) =>
            writeAuditEvent(tx, {
              tenantId: 'single-owner-tenant',
              actorUserId: owner.id,
              action: 'workspace.updated',
              entityId: 'single-owner-tenant',
              metadata: { fields: ['passwordHash'] },
            }),
          app,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_AUDIT_METADATA' });

      await expect(
        withTenant(
          'single-owner-tenant',
          async (tx) => {
            await tx.supplier.create({
              data: {
                id: 'rolled-back-supplier',
                tenantId: 'single-owner-tenant',
                businessName: 'Rollback Foods',
              },
            });
            await writeAuditEvent(tx, {
              tenantId: 'single-owner-tenant',
              actorUserId: owner.id,
              action: 'supplier.created',
              entityId: 'rolled-back-supplier',
            });
            throw new Error('force rollback');
          },
          app,
        ),
      ).rejects.toThrow('force rollback');
      expect(
        await admin.supplier.findUnique({ where: { id: 'rolled-back-supplier' } }),
      ).toBeNull();
      expect(
        await admin.auditEvent.findFirst({
          where: { entityId: 'rolled-back-supplier' },
        }),
      ).toBeNull();
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
