import { PrismaClient } from '@prisma/client';

import { withPostgres } from './setup/postgres';

test('minimal-column migration removes unsupported populated supplier verification data', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    try {
      await migrateTo('20260827000800_award_snapshot_capacity');
      await prisma.tenant.create({
        data: {
          id: 'tenant-a',
          name: 'Alpha Kitchen',
          addressLine: '1 Market Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pin: '400001',
          phone: '9000000001',
        },
      });
      await prisma.supplier.create({
        data: {
          id: 'supplier-a',
          tenantId: 'tenant-a',
          businessName: 'Alpha Produce',
        },
      });
      await prisma.$executeRawUnsafe(`
        UPDATE "Supplier"
        SET "verifiedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'supplier-a'
      `);

      await expect(
        migrateTo('20260827000900_minimal_launch_columns'),
      ).resolves.toBeUndefined();

      const verificationColumns = await prisma.$queryRaw<
        Array<{ column_name: string }>
      >`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Supplier'
          AND column_name IN ('verifiedAt', 'verifiedByUserId')
        ORDER BY column_name
      `;
      expect(verificationColumns).toEqual([]);
      await expect(
        prisma.supplier.findUniqueOrThrow({
          where: { id: 'supplier-a' },
          select: { businessName: true },
        }),
      ).resolves.toEqual({ businessName: 'Alpha Produce' });
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('minimal-column migration preserves request snapshots and removes retired menu facts', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    try {
      await migrateTo('20260827000800_award_snapshot_capacity');
      await prisma.tenant.create({
        data: {
          id: 'tenant-a',
          name: 'Alpha Kitchen',
          addressLine: '1 Market Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pin: '400001',
          phone: '9000000001',
          users: {
            create: {
              id: 'owner-a',
              name: 'Alpha Owner',
              email: 'owner-a@example.test',
              role: 'OWNER',
            },
          },
          menus: {
            create: { id: 'menu-a', name: 'Dinner menu' },
          },
          suppliers: {
            create: {
              id: 'supplier-null-verification',
              businessName: 'Current Produce',
            },
          },
        },
      });
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Recipe" (
          "id", "tenantId", "menuId", "name", "position", "retiredAt"
        ) VALUES
          ('recipe-active', 'tenant-a', 'menu-a', 'Current dish', 0, NULL),
          ('recipe-retired', 'tenant-a', 'menu-a', 'Old dish', 1, CURRENT_TIMESTAMP)
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Ingredient" (
          "id", "tenantId", "recipeId", "name", "quantity", "unit", "position"
        ) VALUES (
          'ingredient-retired', 'tenant-a', 'recipe-retired', 'Urad dal',
          2.500, 'KILOGRAM', 0
        )
      `);
      await prisma.procurementRequest.create({
        data: {
          id: 'request-a',
          tenantId: 'tenant-a',
          title: 'Issued demand',
          status: 'OPEN',
          menuId: 'menu-a',
          deliveryDetails: { address: '1 Market Road' },
          deliveryDate: new Date('2027-01-03T00:00:00.000Z'),
          quoteDeadline: new Date('2027-01-02T10:00:00.000Z'),
          createdByUserId: 'owner-a',
          items: {
            create: {
              id: 'request-item-a',
              tenant: { connect: { id: 'tenant-a' } },
              name: 'Urad dal',
              quantity: '2.5',
              unit: 'KILOGRAM',
            },
          },
        },
      });
      await prisma.$executeRawUnsafe(`
        UPDATE "RequestItem"
        SET "sourceIngredientId" = 'ingredient-retired'
        WHERE "id" = 'request-item-a'
      `);

      await migrateTo('20260827000900_minimal_launch_columns');

      await expect(
        prisma.requestItem.findUniqueOrThrow({
          where: { id: 'request-item-a' },
          select: { name: true, quantity: true, unit: true },
        }),
      ).resolves.toEqual({
        name: 'Urad dal',
        quantity: expect.objectContaining({}),
        unit: 'KILOGRAM',
      });
      expect(
        await prisma.recipe.count({ where: { id: 'recipe-retired' } }),
      ).toBe(0);
      expect(
        await prisma.recipe.count({ where: { id: 'recipe-active' } }),
      ).toBe(1);
      await expect(
        prisma.supplier.findUniqueOrThrow({
          where: { id: 'supplier-null-verification' },
          select: { businessName: true },
        }),
      ).resolves.toEqual({ businessName: 'Current Produce' });
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('minimal-column migration removes retired recipes when run by a non-bypass table owner', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo, applyMigrationAs }) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const migrationRole = 'minimal_columns_owner';
    const migrationPassword = 'minimal-columns-owner-password';

    try {
      await migrateTo('20260827000800_award_snapshot_capacity');
      await prisma.tenant.create({
        data: {
          id: 'tenant-owner-test',
          name: 'Owner Test Kitchen',
          addressLine: '2 Market Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pin: '400002',
          phone: '9000000002',
          menus: {
            create: { id: 'menu-owner-test', name: 'Owner test menu' },
          },
        },
      });
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Recipe" (
          "id", "tenantId", "menuId", "name", "position", "retiredAt"
        ) VALUES
          (
            'recipe-owner-active', 'tenant-owner-test', 'menu-owner-test',
            'Current dish', 0, NULL
          ),
          (
            'recipe-owner-retired', 'tenant-owner-test', 'menu-owner-test',
            'Old dish', 1, CURRENT_TIMESTAMP
          )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Ingredient" (
          "id", "tenantId", "recipeId", "name", "quantity", "unit", "position"
        ) VALUES (
          'ingredient-owner-retired', 'tenant-owner-test',
          'recipe-owner-retired', 'Rice', 1.000, 'KILOGRAM', 0
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE ROLE ${migrationRole}
          LOGIN PASSWORD '${migrationPassword}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
      `);
      await prisma.$executeRawUnsafe(
        `GRANT USAGE ON SCHEMA public TO ${migrationRole}`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Recipe" OWNER TO ${migrationRole}`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "RequestItem" OWNER TO ${migrationRole}`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Supplier" OWNER TO ${migrationRole}`,
      );

      const [role] = await prisma.$queryRawUnsafe<
        Array<{ rolsuper: boolean; rolbypassrls: boolean }>
      >(`
        SELECT rolsuper, rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname = '${migrationRole}'
      `);
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

      const ownerDatabaseUrl = new URL(databaseUrl);
      ownerDatabaseUrl.username = migrationRole;
      ownerDatabaseUrl.password = migrationPassword;
      await applyMigrationAs(
        '20260827000900_minimal_launch_columns',
        ownerDatabaseUrl.toString(),
      );

      const recipes = await prisma.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "Recipe" ORDER BY id`;
      expect(recipes).toEqual([{ id: 'recipe-owner-active' }]);
      const retiredIngredientCount = await prisma.$queryRaw<
        Array<{ count: bigint }>
      >`
        SELECT COUNT(*) AS count
        FROM "Ingredient"
        WHERE id = 'ingredient-owner-retired'
      `;
      expect(retiredIngredientCount).toEqual([{ count: BigInt(0) }]);

      const [recipeRls] = await prisma.$queryRaw<
        Array<{ enabled: boolean; forced: boolean }>
      >`
        SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
        FROM pg_catalog.pg_class
        WHERE oid = 'public."Recipe"'::regclass
      `;
      expect(recipeRls).toEqual({ enabled: true, forced: true });

      const removedColumns = await prisma.$queryRaw<
        Array<{ table_name: string; column_name: string }>
      >`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'Recipe' AND column_name = 'retiredAt')
            OR (
              table_name = 'RequestItem'
              AND column_name = 'sourceIngredientId'
            )
            OR (
              table_name = 'Supplier'
              AND column_name IN ('verifiedAt', 'verifiedByUserId')
            )
          )
        ORDER BY table_name, column_name
      `;
      expect(removedColumns).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
