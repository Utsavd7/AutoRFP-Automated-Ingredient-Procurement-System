import { randomBytes } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
import {
  approveReviewedMenu,
  createDeterministicMenuDraft,
  createReviewedMenuDraft,
  deleteReviewedMenu,
  getReviewedMenu,
  listReviewedMenus,
  MenuConflictError,
  MenuNotFoundError,
  updateReviewedMenuDraft,
} from '@/lib/menu/menu-service';

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

async function seedTenant(
  admin: PrismaClient,
  tenantId: string,
  userId: string,
  email: string,
) {
  await admin.tenant.create({
    data: {
      id: tenantId,
      name: `${tenantId} Kitchen`,
      addressLine: '1 Market Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001',
      phone: '9000000000',
      users: {
        create: {
          id: userId,
          name: `${userId} Name`,
          email,
          role: 'MEMBER',
        },
      },
    },
  });
}

function reviewedDocument(name = 'Dal Makhani'): MenuDocumentV1 {
  return {
    v: 1,
    source: { kind: 'MANUAL', canonicalUrl: null, permissionConfirmed: false },
    dishes: [
      {
        id: 'd1',
        name,
        position: 0,
        ingredients: [
          {
            id: 'i1',
            itemKey: 'urad-dal',
            name: 'Urad dal',
            quantity: '2.5',
            unit: 'KILOGRAM',
            specification: { v: 1, category: 'OTHER' },
          },
        ],
      },
    ],
  };
}

test('menu review uses one bounded document, audits approval, stays tenant scoped, and never mutates on GET', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      await seedTenant(admin, 'tenant-b', 'member-b', 'b@example.test');
      app = await provisionAppClient(admin, databaseUrl);

      const actor = { userId: 'member-a', tenantId: 'tenant-a' };
      const stale = await admin.menu.create({
        data: {
          tenantId: 'tenant-a',
          name: 'Stale source draft',
          document: reviewedDocument('Stale dish') as unknown as Prisma.InputJsonValue,
          sourceText: 'Raw stale source',
          createdByUserId: 'member-a',
        },
      });
      const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
      await admin.menu.update({
        where: { id: stale.id },
        data: { createdAt: expiredAt, updatedAt: expiredAt },
      });

      const created = await createDeterministicMenuDraft(
        { actor, name: 'Weekly dinner', menuText: 'Dal Makhani\nMasala Dosa' },
        app,
      );
      expect(created).toEqual(
        expect.objectContaining({
          tenantId: 'tenant-a',
          status: 'DRAFT',
          version: 1,
          sourceText: 'Dal Makhani\nMasala Dosa',
          document: expect.objectContaining({
            v: 1,
            source: expect.objectContaining({ kind: 'PASTE' }),
            dishes: [
              expect.objectContaining({ id: 'd1', name: 'Dal Makhani', ingredients: [] }),
              expect.objectContaining({ id: 'd2', name: 'Masala Dosa', ingredients: [] }),
            ],
          }),
        }),
      );
      await expect(
        admin.menu.findUniqueOrThrow({ where: { id: stale.id } }),
      ).resolves.toEqual(
        expect.objectContaining({ sourceText: null, updatedAt: expiredAt }),
      );

      await expect(
        approveReviewedMenu({ actor, menuId: created.id, expectedVersion: 1 }, app),
      ).rejects.toBeInstanceOf(MenuConflictError);

      const completeDocument: MenuDocumentV1 = {
        ...(created.document as MenuDocumentV1),
        dishes: (created.document as MenuDocumentV1).dishes.map((dish, index) => ({
          ...dish,
          ingredients: [
            {
              id: `i${index + 1}`,
              itemKey: index === 0 ? 'urad-dal' : 'rice',
              name: index === 0 ? 'Urad dal' : 'Rice',
              quantity: index === 0 ? '2.5' : '5',
              unit: 'KILOGRAM',
              specification: { v: 1, category: 'OTHER' },
            },
          ],
        })),
      };
      const reviewed = await updateReviewedMenuDraft(
        {
          actor,
          menuId: created.id,
          expectedVersion: 1,
          draft: {
            name: 'Weekly dinner',
            sourceText: created.sourceText,
            document: completeDocument,
          },
        },
        app,
      );
      expect(reviewed).toEqual(expect.objectContaining({ status: 'DRAFT', version: 2 }));

      const beforeGet = await admin.menu.findUniqueOrThrow({ where: { id: created.id } });
      const detail = await getReviewedMenu({ actor, menuId: created.id }, app);
      const summary = await listReviewedMenus({ actor, limit: 50 }, app);
      const afterGet = await admin.menu.findUniqueOrThrow({ where: { id: created.id } });
      expect(detail).toEqual(expect.objectContaining({
        document: completeDocument,
        cleanupProposals: expect.any(Array),
        ingredientSuggestionsByDishId: expect.any(Object),
      }));
      expect(afterGet.sourceText).toBe(beforeGet.sourceText);
      expect(afterGet.updatedAt).toEqual(beforeGet.updatedAt);
      const listed = summary.menus.find(({ id }) => id === created.id)!;
      expect(listed).not.toHaveProperty('document');
      expect(listed).not.toHaveProperty('_count');

      const approved = await approveReviewedMenu(
        { actor, menuId: created.id, expectedVersion: 2 },
        app,
      );
      expect(approved).toEqual(expect.objectContaining({
        status: 'APPROVED',
        version: 3,
        approvedByUserId: 'member-a',
        sourceText: null,
      }));
      expect(approved.approvedAt).toBeInstanceOf(Date);
      await expect(
        admin.auditEvent.findMany({ where: { tenantId: 'tenant-a' } }),
      ).resolves.toEqual([
        expect.objectContaining({
          actorUserId: 'member-a',
          action: 'menu.approved',
          entityType: 'Menu',
          entityId: created.id,
          metadata: { version: 3 },
        }),
      ]);

      const tenantBMenu = await admin.menu.create({
        data: {
          tenantId: 'tenant-b',
          name: 'Private B menu',
          status: 'DRAFT',
          document: reviewedDocument(
            'Private B dish',
          ) as unknown as Prisma.InputJsonValue,
          createdByUserId: 'member-b',
        },
      });
      await expect(
        getReviewedMenu({ actor, menuId: tenantBMenu.id }, app),
      ).rejects.toBeInstanceOf(MenuNotFoundError);
      await expect(
        updateReviewedMenuDraft(
          {
            actor,
            menuId: tenantBMenu.id,
            expectedVersion: 1,
            draft: { name: 'Cross-tenant edit', document: reviewedDocument() },
          },
          app,
        ),
      ).rejects.toBeInstanceOf(MenuNotFoundError);
      await expect(
        approveReviewedMenu(
          { actor, menuId: tenantBMenu.id, expectedVersion: 1 },
          app,
        ),
      ).rejects.toBeInstanceOf(MenuNotFoundError);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});

test('menu optimistic versions serialize edit and approval races', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      app = await provisionAppClient(admin, databaseUrl);
      const actor = { userId: 'member-a', tenantId: 'tenant-a' };
      const draft = (name: string) => ({ name, document: reviewedDocument() });

      const editRace = await createReviewedMenuDraft({ actor, draft: draft('Edit race') }, app);
      const editResults = await Promise.allSettled([
        updateReviewedMenuDraft({ actor, menuId: editRace.id, expectedVersion: 1, draft: draft('First edit') }, app),
        updateReviewedMenuDraft({ actor, menuId: editRace.id, expectedVersion: 1, draft: draft('Second edit') }, app),
      ]);
      expect(editResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(editResults.filter(({ status }) => status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.any(MenuConflictError) }),
      ]);

      const transitionRace = await createReviewedMenuDraft({ actor, draft: draft('Edit approve race') }, app);
      const transitionResults = await Promise.allSettled([
        updateReviewedMenuDraft({ actor, menuId: transitionRace.id, expectedVersion: 1, draft: draft('Concurrent edit') }, app),
        approveReviewedMenu({ actor, menuId: transitionRace.id, expectedVersion: 1 }, app),
      ]);
      expect(transitionResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(transitionResults.filter(({ status }) => status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.any(MenuConflictError) }),
      ]);

      const approveRace = await createReviewedMenuDraft({ actor, draft: draft('Approve race') }, app);
      const approveResults = await Promise.allSettled([
        approveReviewedMenu({ actor, menuId: approveRace.id, expectedVersion: 1 }, app),
        approveReviewedMenu({ actor, menuId: approveRace.id, expectedVersion: 1 }, app),
      ]);
      expect(approveResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(approveResults.filter(({ status }) => status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.any(MenuConflictError) }),
      ]);
      await expect(
        admin.auditEvent.count({ where: { entityId: approveRace.id, action: 'menu.approved' } }),
      ).resolves.toBe(1);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});

test('menu deletion maps an FK history race to a conflict', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      app = await provisionAppClient(admin, databaseUrl);
      const actor = { userId: 'member-a', tenantId: 'tenant-a' };
      const menu = await admin.menu.create({
        data: {
          tenantId: actor.tenantId,
          name: 'Deletion race menu',
          document: reviewedDocument() as unknown as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
        },
      });
      let inserted = false;
      const racingClient = {
        $queryRaw: app.$queryRaw.bind(app),
        $transaction: async (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
          app!.$transaction(async (transaction) => {
            const procurementRequest = new Proxy(transaction.procurementRequest, {
              get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver);
                if (property === 'count') {
                  return async (...args: Parameters<typeof target.count>) => {
                    const count = await target.count(...args);
                    if (!inserted) {
                      inserted = true;
                      await admin.procurementRequest.create({
                        data: {
                          tenantId: actor.tenantId,
                          title: 'Concurrent history',
                          menuId: menu.id,
                          items: [],
                          sourcing: [],
                          deliveryDetails: {},
                          deliveryDate: new Date('2099-09-04T00:00:00.000Z'),
                          quoteDeadline: new Date('2099-09-02T08:00:00.000Z'),
                          createdByUserId: actor.userId,
                        },
                      });
                    }
                    return count;
                  };
                }
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
            const transactionWithRace = new Proxy(transaction, {
              get(target, property, receiver) {
                if (property === 'procurementRequest') return procurementRequest;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }) as Prisma.TransactionClient;
            return callback(transactionWithRace);
          }),
      };

      await expect(
        deleteReviewedMenu(
          { actor, menuId: menu.id, expectedVersion: menu.version },
          racingClient as never,
        ),
      ).rejects.toMatchObject({
        message: 'This menu has procurement history and cannot be deleted.',
        code: 'MENU_CONFLICT',
        status: 409,
      });
      await expect(
        admin.menu.findUniqueOrThrow({ where: { id: menu.id } }),
      ).resolves.toBeDefined();
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
