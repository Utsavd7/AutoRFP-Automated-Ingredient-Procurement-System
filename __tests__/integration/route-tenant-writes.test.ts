import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { updateWorkspaceAccount } from '@/lib/account/update-workspace';
import { createMenuDraft } from '@/lib/menu/create-menu-draft';

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
  input: {
    tenantId: string;
    ownerId: string;
    ownerEmail: string;
    memberId?: string;
  },
) {
  await admin.tenant.create({
    data: {
      id: input.tenantId,
      name: `${input.tenantId} Kitchen`,
      addressLine: '1 Market Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001',
      phone: '9000000000',
      users: {
        create: [
          {
            id: input.ownerId,
            name: `${input.ownerId} Name`,
            email: input.ownerEmail,
            role: 'OWNER',
          },
          ...(input.memberId
            ? [
                {
                  id: input.memberId,
                  name: `${input.memberId} Name`,
                  email: `${input.memberId}@example.test`,
                  role: 'MEMBER' as const,
                },
              ]
            : []),
        ],
      },
    },
  });
}

const accountUpdate = {
  name: 'Updated Kitchen',
  email: 'updated-owner-a@example.test',
  addressLine: '2 New Road',
  city: 'Pune',
  state: 'Maharashtra',
  pin: '411001',
  phone: '9000000002',
};

test('restricted route services scope account and menu writes to the current tenant', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    let app: PrismaClient | undefined;

    try {
      await seedWorkspace(admin, {
        tenantId: 'tenant-a',
        ownerId: 'owner-a',
        ownerEmail: 'owner-a@example.test',
        memberId: 'member-a',
      });
      await seedWorkspace(admin, {
        tenantId: 'tenant-b',
        ownerId: 'owner-b',
        ownerEmail: 'owner-b@example.test',
      });
      app = await provisionAppClient(admin, databaseUrl);

      const updated = await updateWorkspaceAccount(
        {
          actor: { userId: 'owner-a', tenantId: 'tenant-a' },
          ...accountUpdate,
        },
        app,
      );
      expect(updated.tenant).toEqual(
        expect.objectContaining({
          id: 'tenant-a',
          name: 'Updated Kitchen',
          city: 'Pune',
        }),
      );
      expect(updated.user).toEqual(
        expect.objectContaining({
          id: 'owner-a',
          name: 'owner-a Name',
          email: 'updated-owner-a@example.test',
        }),
      );
      expect(
        await admin.auditEvent.findMany({ where: { tenantId: 'tenant-a' } }),
      ).toEqual([
        expect.objectContaining({
          actorUserId: 'owner-a',
          action: 'workspace.updated',
          entityType: 'Tenant',
          entityId: 'tenant-a',
          metadata: {
            fields: [
              'name',
              'email',
              'addressLine',
              'city',
              'pin',
              'phone',
            ],
          },
        }),
      ]);

      await expect(
        updateWorkspaceAccount(
          {
            actor: { userId: 'member-a', tenantId: 'tenant-a' },
            ...accountUpdate,
            name: 'Member Changed This',
          },
          app,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        updateWorkspaceAccount(
          {
            actor: { userId: 'owner-b', tenantId: 'tenant-a' },
            ...accountUpdate,
            name: 'Cross Tenant Changed This',
          },
          app,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await expect(
        updateWorkspaceAccount(
          {
            actor: { userId: 'owner-a', tenantId: 'tenant-a' },
            ...accountUpdate,
            name: 'Must Roll Back',
            email: 'owner-b@example.test',
          },
          app,
        ),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(await admin.tenant.findUnique({ where: { id: 'tenant-a' } }))
        .toEqual(expect.objectContaining({ name: 'Updated Kitchen' }));
      expect(
        await admin.auditEvent.count({ where: { tenantId: 'tenant-a' } }),
      ).toBe(1);
      expect(await admin.tenant.findUnique({ where: { id: 'tenant-b' } }))
        .toEqual(expect.objectContaining({ name: 'tenant-b Kitchen' }));

      const menu = await createMenuDraft(
        { tenantId: 'tenant-a', menuText: 'Paneer Tikka\nMasala Dosa' },
        app,
      );
      expect(menu.recipes.map(({ name }) => name)).toEqual([
        'Paneer Tikka',
        'Masala Dosa',
      ]);
      expect(await admin.menu.findUnique({ where: { id: menu.id } })).toEqual(
        expect.objectContaining({ tenantId: 'tenant-a', status: 'DRAFT' }),
      );
      await expect(
        app.menu.create({
          data: {
            tenantId: 'tenant-a',
            name: 'Unscoped menu',
            status: 'DRAFT',
          },
        }),
      ).rejects.toThrow(/row-level security/i);
      expect(
        await admin.menu.count({ where: { tenantId: 'tenant-b' } }),
      ).toBe(0);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
