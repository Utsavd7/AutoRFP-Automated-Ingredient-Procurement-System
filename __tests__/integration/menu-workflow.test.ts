import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  approveReviewedMenu,
  createDeterministicMenuDraft,
  createReviewedMenuDraft,
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

test('member review, approval, and edits stay tenant scoped and preserve issued demand', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      await seedTenant(admin, 'tenant-b', 'member-b', 'b@example.test');
      app = await provisionAppClient(admin, databaseUrl);

      const actor = { userId: 'member-a', tenantId: 'tenant-a' };
      const menu = await createDeterministicMenuDraft(
        {
          actor,
          name: 'Weekly dinner',
          menuText: 'Dal Makhani\nMasala Dosa',
        },
        app,
      );
      expect(menu).toEqual(
        expect.objectContaining({
          tenantId: 'tenant-a',
          status: 'DRAFT',
          version: 1,
          approvedAt: null,
          approvedByUserId: null,
          createdByUserId: 'member-a',
          sourceText: 'Dal Makhani\nMasala Dosa',
        }),
      );
      expect(menu.recipes).toHaveLength(2);

      await expect(
        approveReviewedMenu(
          { actor, menuId: menu.id, expectedVersion: 1 },
          app,
        ),
      ).rejects.toBeInstanceOf(MenuConflictError);

      const reviewed = await updateReviewedMenuDraft(
        {
          actor,
          menuId: menu.id,
          expectedVersion: 1,
          draft: {
            name: 'Weekly dinner',
            sourceText: menu.sourceText,
            dishes: menu.recipes.map((recipe, index) => ({
              id: recipe.id,
              name: recipe.name,
              ingredients:
                index === 0
                  ? [
                      { name: 'Urad dal', quantity: '2.500', unit: 'kg' },
                      { name: 'Butter', quantity: '0.500', unit: 'kg' },
                    ]
                  : [{ name: 'Rice', quantity: '5', unit: 'kg' }],
            })),
          },
        },
        app,
      );
      expect(reviewed.status).toBe('DRAFT');
      expect(reviewed.version).toBe(2);

      const approved = await approveReviewedMenu(
        { actor, menuId: menu.id, expectedVersion: 2 },
        app,
      );
      expect(approved).toEqual(
        expect.objectContaining({
          status: 'APPROVED',
          version: 3,
          approvedByUserId: 'member-a',
          sourceText: null,
        }),
      );
      expect(approved.approvedAt).toBeInstanceOf(Date);
      expect(await admin.auditEvent.findMany({ where: { tenantId: 'tenant-a' } }))
        .toEqual([
          expect.objectContaining({
            actorUserId: 'member-a',
            action: 'menu.approved',
            entityType: 'Menu',
            entityId: menu.id,
            metadata: { version: 3 },
          }),
        ]);

      const ingredientBeforeEdit = approved.recipes[0]?.ingredients[0];
      expect(ingredientBeforeEdit).toBeDefined();
      const request = await admin.procurementRequest.create({
        data: {
          tenantId: 'tenant-a',
          title: 'Issued weekly demand',
          status: 'OPEN',
          menuId: menu.id,
          deliveryDetails: { address: '1 Market Road' },
          quoteDeadline: new Date('2027-01-02T10:00:00.000Z'),
          deliveryDate: new Date('2027-01-03T00:00:00.000Z'),
          createdByUserId: 'member-a',
          openedAt: new Date('2027-01-01T00:00:00.000Z'),
          items: {
            create: {
              tenant: { connect: { id: 'tenant-a' } },
              sourceIngredient: {
                connect: {
                  tenantId_id: {
                    tenantId: 'tenant-a',
                    id: ingredientBeforeEdit!.id,
                  },
                },
              },
              name: ingredientBeforeEdit!.name,
              quantity: ingredientBeforeEdit!.quantity,
              unit: ingredientBeforeEdit!.unit,
            },
          },
        },
        include: { items: true },
      });
      const requestItemBeforeEdit = await admin.requestItem.findUniqueOrThrow({
        where: { id: request.items[0]!.id },
      });

      const edited = await updateReviewedMenuDraft(
        {
          actor,
          menuId: menu.id,
          expectedVersion: 3,
          draft: {
            name: 'Weekly dinner corrected',
            dishes: approved.recipes.slice(1).map((recipe) => ({
              id: recipe.id,
              name: recipe.name,
              ingredients: recipe.ingredients.map((item, itemIndex) => ({
                id: item.id,
                name: itemIndex === 0 ? 'Sona masoori rice' : item.name,
                quantity: item.quantity.toString(),
                unit: item.unit,
              })),
            })),
          },
        },
        app,
      );
      expect(edited).toEqual(
        expect.objectContaining({
          status: 'DRAFT',
          version: 4,
          approvedAt: null,
          approvedByUserId: null,
        }),
      );
      expect(edited.recipes).toHaveLength(1);
      expect(edited.recipes[0]?.ingredients[0]).toEqual(
        expect.objectContaining({ name: 'Sona masoori rice' }),
      );
      const requestItemAfterEdit = await admin.requestItem.findUniqueOrThrow({
        where: { id: request.items[0]!.id },
      });
      expect(requestItemAfterEdit).toEqual(requestItemBeforeEdit);
      const [retiredFact] = await admin.$queryRaw<
        Array<{
          recipeName: string;
          ingredientName: string;
          quantity: string;
          unit: string;
          retiredAt: Date | null;
        }>
      >`
        SELECT
          recipe."name" AS "recipeName",
          ingredient."name" AS "ingredientName",
          ingredient."quantity"::TEXT AS "quantity",
          ingredient."unit"::TEXT AS "unit",
          recipe."retiredAt" AS "retiredAt"
        FROM "Recipe" AS recipe
        JOIN "Ingredient" AS ingredient
          ON ingredient."tenantId" = recipe."tenantId"
         AND ingredient."recipeId" = recipe."id"
        WHERE recipe."tenantId" = 'tenant-a'
          AND ingredient."id" = ${ingredientBeforeEdit!.id}
      `;
      expect(retiredFact).toEqual({
        recipeName: 'Dal Makhani',
        ingredientName: 'Urad dal',
        quantity: '2.500',
        unit: 'KILOGRAM',
        retiredAt: expect.any(Date),
      });
      expect(
        await admin.ingredient.count({
          where: {
            tenantId: 'tenant-a',
            recipeId: ingredientBeforeEdit!.recipeId,
            name: 'Butter',
          },
        }),
      ).toBe(0);
      const visibleMenu = await getReviewedMenu(
        { actor, menuId: menu.id },
        app,
      );
      expect(
        visibleMenu.recipes.some(
          ({ id }) => id === ingredientBeforeEdit!.recipeId,
        ),
      ).toBe(false);

      await approveReviewedMenu(
        { actor, menuId: menu.id, expectedVersion: 4 },
        app,
      );
      expect(
        await admin.requestItem.findUniqueOrThrow({
          where: { id: request.items[0]!.id },
        }),
      ).toEqual(requestItemBeforeEdit);

      const tenantBMenu = await admin.menu.create({
        data: {
          tenantId: 'tenant-b',
          name: 'Private B menu',
          status: 'DRAFT',
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
            draft: { name: 'Cross-tenant edit', dishes: [] },
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

      const sourceDraft = await createDeterministicMenuDraft(
        { actor, name: 'Private source draft', menuText: 'Poha' },
        app,
      );
      const summary = await listReviewedMenus({ actor, limit: 50 }, app);
      expect(summary.menus.find(({ id }) => id === sourceDraft.id)).toEqual(
        expect.objectContaining({
          id: sourceDraft.id,
          name: 'Private source draft',
          status: 'DRAFT',
          version: 1,
        }),
      );
      expect(
        Object.prototype.hasOwnProperty.call(
          summary.menus.find(({ id }) => id === sourceDraft.id)!,
          'sourceText',
        ),
      ).toBe(false);
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
      const draft = (name: string) => ({
        name,
        dishes: [
          {
            name: 'Dal',
            ingredients: [{ name: 'Urad dal', quantity: '2', unit: 'kg' }],
          },
        ],
      });

      const editRace = await createReviewedMenuDraft(
        { actor, draft: draft('Edit race') },
        app,
      );
      const editResults = await Promise.allSettled([
        updateReviewedMenuDraft(
          {
            actor,
            menuId: editRace.id,
            expectedVersion: 1,
            draft: draft('First edit'),
          },
          app,
        ),
        updateReviewedMenuDraft(
          {
            actor,
            menuId: editRace.id,
            expectedVersion: 1,
            draft: draft('Second edit'),
          },
          app,
        ),
      ]);
      expect(editResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(editResults.filter(({ status }) => status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.any(MenuConflictError) }),
      ]);
      expect(await admin.menu.findUniqueOrThrow({ where: { id: editRace.id } }))
        .toEqual(expect.objectContaining({ version: 2, status: 'DRAFT' }));

      const transitionRace = await createReviewedMenuDraft(
        { actor, draft: draft('Edit approve race') },
        app,
      );
      const transitionResults = await Promise.allSettled([
        updateReviewedMenuDraft(
          {
            actor,
            menuId: transitionRace.id,
            expectedVersion: 1,
            draft: draft('Concurrent edit'),
          },
          app,
        ),
        approveReviewedMenu(
          { actor, menuId: transitionRace.id, expectedVersion: 1 },
          app,
        ),
      ]);
      expect(
        transitionResults.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        transitionResults.filter(({ status }) => status === 'rejected'),
      ).toEqual([
        expect.objectContaining({ reason: expect.any(MenuConflictError) }),
      ]);
      expect(
        await admin.menu.findUniqueOrThrow({ where: { id: transitionRace.id } }),
      ).toEqual(expect.objectContaining({ version: 2 }));

      const approveRace = await createReviewedMenuDraft(
        { actor, draft: draft('Approve race') },
        app,
      );
      const approveResults = await Promise.allSettled([
        approveReviewedMenu(
          { actor, menuId: approveRace.id, expectedVersion: 1 },
          app,
        ),
        approveReviewedMenu(
          { actor, menuId: approveRace.id, expectedVersion: 1 },
          app,
        ),
      ]);
      expect(
        approveResults.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(approveResults.filter(({ status }) => status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.any(MenuConflictError) }),
      ]);
      expect(await admin.menu.findUniqueOrThrow({ where: { id: approveRace.id } }))
        .toEqual(expect.objectContaining({ version: 2, status: 'APPROVED' }));
      expect(
        await admin.auditEvent.count({
          where: { entityId: approveRace.id, action: 'menu.approved' },
        }),
      ).toBe(1);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});

test('menu activity opportunistically removes expired draft source text per tenant', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      await seedTenant(admin, 'tenant-b', 'member-b', 'b@example.test');
      app = await provisionAppClient(admin, databaseUrl);
      const actorA = { userId: 'member-a', tenantId: 'tenant-a' };
      const actorB = { userId: 'member-b', tenantId: 'tenant-b' };
      const oldA = await createDeterministicMenuDraft(
        { actor: actorA, name: 'Old A', menuText: 'Poha' },
        app,
      );
      const recentA = await createDeterministicMenuDraft(
        { actor: actorA, name: 'Recent A', menuText: 'Upma' },
        app,
      );
      const oldB = await createDeterministicMenuDraft(
        { actor: actorB, name: 'Old B', menuText: 'Idli' },
        app,
      );
      const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
      await admin.menu.updateMany({
        where: { id: { in: [oldA.id, oldB.id] } },
        data: { createdAt: expiredAt, updatedAt: expiredAt },
      });

      const oldUpdatedAt = (
        await admin.menu.findUniqueOrThrow({ where: { id: oldA.id } })
      ).updatedAt;
      const summary = await listReviewedMenus({ actor: actorA, limit: 50 }, app);

      expect(await admin.menu.findUniqueOrThrow({ where: { id: oldA.id } }))
        .toEqual(
          expect.objectContaining({
            sourceText: null,
            updatedAt: oldUpdatedAt,
          }),
        );
      expect(await admin.menu.findUniqueOrThrow({ where: { id: recentA.id } }))
        .toEqual(expect.objectContaining({ sourceText: 'Upma' }));
      expect(await admin.menu.findUniqueOrThrow({ where: { id: oldB.id } }))
        .toEqual(expect.objectContaining({ sourceText: 'Idli' }));
      expect(summary.menus.map(({ id }) => id)).toEqual([recentA.id, oldA.id]);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});

test('restaurant-sized maximum menu shape completes inside the bounded transaction', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      app = await provisionAppClient(admin, databaseUrl);
      const actor = { userId: 'member-a', tenantId: 'tenant-a' };
      const dishes = Array.from({ length: 250 }, (_, dishIndex) => ({
        name: `Dish ${dishIndex + 1}`,
        ingredients: Array.from({ length: 4 }, (_, ingredientIndex) => ({
          name: `Ingredient ${dishIndex + 1}-${ingredientIndex + 1}`,
          quantity: `${ingredientIndex + 1}.125`,
          unit: 'kg',
        })),
      }));

      const created = await createReviewedMenuDraft(
        { actor, draft: { name: 'Maximum launch menu', dishes } },
        app,
      );
      expect(created.recipes).toHaveLength(250);
      expect(
        created.recipes.reduce(
          (count, recipe) => count + recipe.ingredients.length,
          0,
        ),
      ).toBe(1_000);

      const updated = await updateReviewedMenuDraft(
        {
          actor,
          menuId: created.id,
          expectedVersion: 1,
          draft: { name: 'Maximum launch menu updated', dishes },
        },
        app,
      );
      expect(updated).toEqual(
        expect.objectContaining({
          name: 'Maximum launch menu updated',
          version: 2,
        }),
      );
      expect(updated.recipes).toHaveLength(250);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
