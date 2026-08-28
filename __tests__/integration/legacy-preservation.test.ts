import { PrismaClient } from '@prisma/client';

import { withPostgres } from './setup/postgres';

test('launch migration preserves credible legacy tenant and menu composition safely', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    try {
      await migrateTo('20260827000100_lean_baseline');

      await prisma.$executeRawUnsafe(`
        INSERT INTO "Tenant" (
          "id", "restaurantName", "email", "passwordHash", "passwordSalt",
          "location", "preferredSuppliers", "createdAt", "updatedAt"
        ) VALUES
          ('tenant-a', 'Alpha Kitchen', ' OWNER@Example.COM ', 'legacy-hash', 'legacy-salt', '12 Market Road', ARRAY[]::TEXT[], '2025-01-01', '2025-01-02'),
          ('tenant-b', 'Beta Kitchen', 'owner@example.com', NULL, NULL, '', ARRAY[]::TEXT[], '2025-02-01', '2025-02-02'),
          ('tenant-c', 'Gamma Kitchen', '   ', NULL, NULL, 'Old Town', ARRAY[]::TEXT[], '2025-03-01', '2025-03-02')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Menu" (
          "id", "tenantId", "text", "mealName", "workflowStatus", "lastActivityAt"
        ) VALUES
          ('menu-a', 'tenant-a', 'dal and rice', 'Dinner', 'APPROVED', '2025-04-01'),
          ('menu-b', 'tenant-b', 'tea service', 'Breakfast', 'DRAFT', '2025-04-02')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Recipe" ("id", "name", "menuId")
        VALUES ('recipe-a', 'Dal', 'menu-a')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Ingredient" ("id", "name", "quantity", "unit", "recipeId") VALUES
          ('ingredient-rounded', 'Lentils', 1.2345, 'Kg', 'recipe-a'),
          ('ingredient-rounds-zero', 'Saffron', 0.0004, 'g', 'recipe-a'),
          ('ingredient-rounds-minimum', 'Salt', 0.0006, 'GRAMS', 'recipe-a'),
          ('ingredient-too-large', 'Water', 1000000000000000, 'litre', 'recipe-a'),
          ('ingredient-nan', 'Oil', 'NaN'::DOUBLE PRECISION, 'ml', 'recipe-a'),
          ('ingredient-infinity', 'Spice', 'Infinity'::DOUBLE PRECISION, 'case', 'recipe-a'),
          ('ingredient-negative', 'Flour', -2, 'pack', 'recipe-a'),
          ('ingredient-unknown-unit', 'Garnish', 2, 'handful', 'recipe-a')
      `);

      await migrateTo('20260827000200_launch_schema');

      const tenants = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          addressLine: string;
          city: string;
          state: string;
          pin: string;
          phone: string;
          timezone: string;
          gstin: string | null;
        }>
      >('SELECT * FROM "Tenant" ORDER BY "id"');
      expect(tenants).toEqual([
        expect.objectContaining({
          id: 'tenant-a',
          name: 'Alpha Kitchen',
          addressLine: '12 Market Road',
          city: 'LEGACY_REVIEW_REQUIRED',
          state: 'LEGACY_REVIEW_REQUIRED',
          pin: '000000',
          phone: 'LEGACY_REVIEW_REQUIRED',
          timezone: 'Asia/Kolkata',
          gstin: null,
        }),
        expect.objectContaining({
          id: 'tenant-b',
          addressLine: 'LEGACY_REVIEW_REQUIRED',
        }),
        expect.objectContaining({ id: 'tenant-c', addressLine: 'Old Town' }),
      ]);

      const users = await prisma.$queryRawUnsafe<
        Array<{
          tenantId: string;
          email: string;
          passwordHash: string | null;
          legacyPasswordSalt: string | null;
          role: string;
        }>
      >(`
        SELECT "tenantId", "email", "passwordHash", "legacyPasswordSalt", "role"::TEXT
        FROM "User"
        ORDER BY "tenantId"
      `);
      expect(users).toHaveLength(3);
      expect(users[0]).toEqual({
        tenantId: 'tenant-a',
        email: 'owner@example.com',
        passwordHash: 'legacy-hash',
        legacyPasswordSalt: 'legacy-salt',
        role: 'OWNER',
      });
      expect(users[1]).toEqual(
        expect.objectContaining({
          tenantId: 'tenant-b',
          passwordHash: null,
          legacyPasswordSalt: null,
          role: 'OWNER',
        }),
      );
      expect(users[1].email).toMatch(/^legacy\+[0-9a-f]{24}@invalid\.local$/);
      expect(users[2].email).toMatch(/^legacy\+[0-9a-f]{24}@invalid\.local$/);
      expect(new Set(users.map(({ email }) => email)).size).toBe(3);

      const menus = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          tenantId: string;
          status: string;
          sourceText: string | null;
          createdByUserId: string | null;
        }>
      >(`
        SELECT "id", "tenantId", "status"::TEXT, "sourceText", "createdByUserId"
        FROM "Menu"
        ORDER BY "id"
      `);
      expect(menus).toHaveLength(2);
      expect(menus.map(({ id }) => id)).toEqual(['menu-a', 'menu-b']);
      expect(menus).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'menu-a',
            tenantId: 'tenant-a',
            status: 'DRAFT',
            sourceText: 'dal and rice',
            createdByUserId: expect.any(String),
          }),
        ]),
      );

      const recipes = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "Recipe" ORDER BY "id"',
      );
      expect(recipes).toEqual([{ id: 'recipe-a' }]);

      const ingredients = await prisma.$queryRawUnsafe<
        Array<{ id: string; quantity: unknown; unit: string }>
      >(`
        SELECT "id", "quantity", "unit"::TEXT
        FROM "Ingredient"
        ORDER BY "id"
      `);
      expect(
        ingredients.map(({ id, quantity, unit }) => ({
          id,
          quantity: String(quantity),
          unit,
        })),
      ).toEqual([
        { id: 'ingredient-infinity', quantity: '1', unit: 'CASE' },
        { id: 'ingredient-nan', quantity: '1', unit: 'MILLILITRE' },
        { id: 'ingredient-negative', quantity: '1', unit: 'PACK' },
        { id: 'ingredient-rounded', quantity: '1.235', unit: 'KILOGRAM' },
        { id: 'ingredient-rounds-minimum', quantity: '0.001', unit: 'GRAM' },
        { id: 'ingredient-rounds-zero', quantity: '1', unit: 'GRAM' },
        { id: 'ingredient-too-large', quantity: '1', unit: 'LITRE' },
        { id: 'ingredient-unknown-unit', quantity: '2', unit: 'PIECE' },
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('launch migration resolves an unowned legacy menu when exactly one tenant exists', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    try {
      await migrateTo('20260827000100_lean_baseline');
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Tenant" (
          "id", "restaurantName", "email", "location",
          "preferredSuppliers", "createdAt", "updatedAt"
        ) VALUES (
          'only-tenant', 'Only Kitchen', 'owner@only.example', 'Pune',
          ARRAY[]::TEXT[], '2025-01-01', '2025-01-02'
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Menu" (
          "id", "tenantId", "text", "mealName", "workflowStatus", "lastActivityAt"
        ) VALUES (
          'unowned-menu', NULL, 'idli and sambar', 'Breakfast', 'DRAFT', '2025-04-01'
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Recipe" ("id", "name", "menuId")
        VALUES ('unowned-recipe', 'Idli', 'unowned-menu')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Ingredient" ("id", "name", "quantity", "unit", "recipeId")
        VALUES ('unowned-ingredient', 'Rice', 2, 'kg', 'unowned-recipe')
      `);

      await migrateTo('20260827000200_launch_schema');

      await expect(
        prisma.$queryRawUnsafe(`
          SELECT menu."tenantId", recipe."tenantId" AS "recipeTenantId",
                 ingredient."tenantId" AS "ingredientTenantId"
          FROM "Menu" menu
          JOIN "Recipe" recipe ON recipe."menuId" = menu."id"
          JOIN "Ingredient" ingredient ON ingredient."recipeId" = recipe."id"
          WHERE menu."id" = 'unowned-menu'
        `),
      ).resolves.toEqual([
        {
          tenantId: 'only-tenant',
          recipeTenantId: 'only-tenant',
          ingredientTenantId: 'only-tenant',
        },
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('launch migration rejects ambiguous legacy menu ownership without dropping composition', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    try {
      await migrateTo('20260827000100_lean_baseline');
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Tenant" (
          "id", "restaurantName", "email", "location",
          "preferredSuppliers", "createdAt", "updatedAt"
        ) VALUES
          ('tenant-a', 'Alpha Kitchen', 'alpha@example.com', 'Mumbai', ARRAY[]::TEXT[], '2025-01-01', '2025-01-02'),
          ('tenant-b', 'Beta Kitchen', 'beta@example.com', 'Delhi', ARRAY[]::TEXT[], '2025-01-01', '2025-01-02')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Menu" (
          "id", "tenantId", "text", "mealName", "workflowStatus", "lastActivityAt"
        ) VALUES (
          'ambiguous-menu', NULL, 'unowned menu', 'Unknown', 'DRAFT', '2025-04-01'
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Recipe" ("id", "name", "menuId")
        VALUES ('ambiguous-recipe', 'Unknown', 'ambiguous-menu')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Ingredient" ("id", "name", "quantity", "unit", "recipeId")
        VALUES ('ambiguous-ingredient', 'Unknown', 1, 'piece', 'ambiguous-recipe')
      `);

      await expect(
        migrateTo('20260827000200_launch_schema'),
      ).rejects.toThrow(
        /Launch migration blocked: unresolved legacy Menu\.tenantId values\. Assign every legacy Menu\.tenantId to an existing Tenant before rerunning\./,
      );

      await expect(
        prisma.$queryRawUnsafe(`
          SELECT menu."id" AS "menuId", menu."tenantId",
                 recipe."id" AS "recipeId", ingredient."id" AS "ingredientId"
          FROM "Menu" menu
          JOIN "Recipe" recipe ON recipe."menuId" = menu."id"
          JOIN "Ingredient" ingredient ON ingredient."recipeId" = recipe."id"
          WHERE menu."id" = 'ambiguous-menu'
        `),
      ).resolves.toEqual([
        {
          menuId: 'ambiguous-menu',
          tenantId: null,
          recipeId: 'ambiguous-recipe',
          ingredientId: 'ambiguous-ingredient',
        },
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
