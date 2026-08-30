import { PrismaClient } from '@prisma/client';

import { withMigratedPostgres } from './setup/postgres';

const launchTables = [
  'AuditEvent',
  'Award',
  'AwardLine',
  'ExternalIdentity',
  'Ingredient',
  'Invitation',
  'Menu',
  'ProcurementRequest',
  'RateLimitBucket',
  'Recipe',
  'RequestItem',
  'Supplier',
  'SupplierQuote',
  'SupplierQuoteItem',
  'SupplierRequest',
  'Tenant',
  'User',
];

const tenantOwnedTables = launchTables.filter(
  (table) => table !== 'Tenant' && table !== 'RateLimitBucket',
);

type CatalogColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  numeric_precision: number | null;
  numeric_scale: number | null;
  character_maximum_length: number | null;
};

type CatalogConstraint = {
  table_name: string;
  constraint_type: string;
  columns: string[];
  foreign_table_name: string | null;
  foreign_columns: string[] | null;
  delete_rule: string | null;
};

type CatalogUniqueIndex = {
  table_name: string;
  columns: string[];
};

type CatalogEnum = {
  enum_name: string;
  enum_value: string;
  sort_order: number;
};

type CatalogCheck = {
  table_name: string;
  constraint_name: string;
  definition: string;
};

function columnKey(column: Pick<CatalogColumn, 'table_name' | 'column_name'>) {
  return `${column.table_name}.${column.column_name}`;
}

function constraintKey(constraint: CatalogConstraint) {
  return [
    constraint.table_name,
    constraint.constraint_type,
    constraint.columns.join(','),
    constraint.foreign_table_name ?? '',
    constraint.foreign_columns?.join(',') ?? '',
    constraint.delete_rule ?? '',
  ].join('|');
}

test('database catalog exposes only the tenant-safe launch authority', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    try {
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;
      const columns = await prisma.$queryRaw<CatalogColumn[]>`
        SELECT
          table_name,
          column_name,
          data_type,
          is_nullable,
          numeric_precision,
          numeric_scale,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name <> '_prisma_migrations'
        ORDER BY table_name, ordinal_position
      `;
      const constraints = await prisma.$queryRaw<CatalogConstraint[]>`
        SELECT
          child_table.relname AS table_name,
          'FOREIGN KEY'::TEXT AS constraint_type,
          array_agg(child_column.attname ORDER BY key_pair.ordinality)::TEXT[] AS columns,
          parent_table.relname AS foreign_table_name,
          array_agg(parent_column.attname ORDER BY key_pair.ordinality)::TEXT[] AS foreign_columns,
          CASE foreign_key.confdeltype
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'a' THEN 'NO ACTION'
          END AS delete_rule
        FROM pg_catalog.pg_constraint foreign_key
        JOIN pg_catalog.pg_class child_table
          ON child_table.oid = foreign_key.conrelid
        JOIN pg_catalog.pg_namespace child_namespace
          ON child_namespace.oid = child_table.relnamespace
        JOIN pg_catalog.pg_class parent_table
          ON parent_table.oid = foreign_key.confrelid
        CROSS JOIN LATERAL unnest(foreign_key.conkey, foreign_key.confkey)
          WITH ORDINALITY AS key_pair(child_attnum, parent_attnum, ordinality)
        JOIN pg_catalog.pg_attribute child_column
          ON child_column.attrelid = child_table.oid
         AND child_column.attnum = key_pair.child_attnum
        JOIN pg_catalog.pg_attribute parent_column
          ON parent_column.attrelid = parent_table.oid
         AND parent_column.attnum = key_pair.parent_attnum
        WHERE child_namespace.nspname = 'public'
          AND foreign_key.contype = 'f'
        GROUP BY
          child_table.relname,
          parent_table.relname,
          foreign_key.oid,
          foreign_key.confdeltype
        ORDER BY child_table.relname, foreign_key.oid
      `;
      const uniqueIndexes = await prisma.$queryRaw<CatalogUniqueIndex[]>`
        SELECT
          table_class.relname AS table_name,
          array_agg(attribute.attname ORDER BY key_column.ordinality)::text[] AS columns
        FROM pg_catalog.pg_index index_catalog
        JOIN pg_catalog.pg_class table_class
          ON table_class.oid = index_catalog.indrelid
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = table_class.relnamespace
        CROSS JOIN LATERAL unnest(index_catalog.indkey)
          WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = table_class.oid
         AND attribute.attnum = key_column.attnum
        WHERE namespace.nspname = 'public'
          AND index_catalog.indisunique
          AND NOT index_catalog.indisprimary
        GROUP BY table_class.relname, index_catalog.indexrelid
        ORDER BY table_class.relname, index_catalog.indexrelid
      `;
      const enums = await prisma.$queryRaw<CatalogEnum[]>`
        SELECT
          type_catalog.typname AS enum_name,
          enum_catalog.enumlabel AS enum_value,
          enum_catalog.enumsortorder::INTEGER AS sort_order
        FROM pg_catalog.pg_type type_catalog
        JOIN pg_catalog.pg_enum enum_catalog
          ON enum_catalog.enumtypid = type_catalog.oid
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = type_catalog.typnamespace
        WHERE namespace.nspname = 'public'
        ORDER BY type_catalog.typname, enum_catalog.enumsortorder
      `;
      const checks = await prisma.$queryRaw<CatalogCheck[]>`
        SELECT
          table_class.relname AS table_name,
          check_catalog.conname AS constraint_name,
          pg_get_constraintdef(check_catalog.oid) AS definition
        FROM pg_catalog.pg_constraint check_catalog
        JOIN pg_catalog.pg_class table_class
          ON table_class.oid = check_catalog.conrelid
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = table_class.relnamespace
        WHERE namespace.nspname = 'public'
          AND check_catalog.contype = 'c'
        ORDER BY table_class.relname, check_catalog.conname
      `;

      expect(tables.map(({ tablename }) => tablename)).toEqual([
        ...launchTables,
        '_prisma_migrations',
      ].sort());

      const columnsByKey = new Map(columns.map((column) => [columnKey(column), column]));

      expect(columns).toHaveLength(169);

      for (const table of tenantOwnedTables) {
        expect(columnsByKey.get(`${table}.tenantId`)).toEqual(
          expect.objectContaining({ data_type: 'text', is_nullable: 'NO' }),
        );
      }
      expect(columnsByKey.has('Tenant.tenantId')).toBe(false);
      expect(columnsByKey.has('RateLimitBucket.tenantId')).toBe(false);
      expect(columnsByKey.has('RateLimitBucket.updatedAt')).toBe(false);
      for (const removedColumn of [
        'Recipe.retiredAt',
        'RequestItem.sourceIngredientId',
        'Supplier.verifiedAt',
        'Supplier.verifiedByUserId',
        'User.legacyPasswordSalt',
      ]) {
        expect(columnsByKey.has(removedColumn)).toBe(false);
      }
      expect(
        columns
          .filter(({ table_name }) => table_name === 'ExternalIdentity')
          .map(({ column_name }) => column_name)
          .sort(),
      ).toEqual(
        ['createdAt', 'provider', 'providerAccountId', 'tenantId', 'userId'].sort(),
      );

      expect(enums).toEqual([
        { enum_name: 'MenuStatus', enum_value: 'DRAFT', sort_order: 1 },
        { enum_name: 'MenuStatus', enum_value: 'APPROVED', sort_order: 2 },
        {
          enum_name: 'ProcurementRequestStatus',
          enum_value: 'DRAFT',
          sort_order: 1,
        },
        {
          enum_name: 'ProcurementRequestStatus',
          enum_value: 'OPEN',
          sort_order: 2,
        },
        {
          enum_name: 'ProcurementRequestStatus',
          enum_value: 'AWARDED',
          sort_order: 3,
        },
        {
          enum_name: 'ProcurementRequestStatus',
          enum_value: 'CANCELLED',
          sort_order: 4,
        },
        {
          enum_name: 'ProcurementUnit',
          enum_value: 'KILOGRAM',
          sort_order: 1,
        },
        { enum_name: 'ProcurementUnit', enum_value: 'GRAM', sort_order: 2 },
        { enum_name: 'ProcurementUnit', enum_value: 'LITRE', sort_order: 3 },
        {
          enum_name: 'ProcurementUnit',
          enum_value: 'MILLILITRE',
          sort_order: 4,
        },
        { enum_name: 'ProcurementUnit', enum_value: 'PIECE', sort_order: 5 },
        { enum_name: 'ProcurementUnit', enum_value: 'PACK', sort_order: 6 },
        { enum_name: 'ProcurementUnit', enum_value: 'CASE', sort_order: 7 },
        { enum_name: 'ProcurementUnit', enum_value: 'CRATE', sort_order: 8 },
        { enum_name: 'UserRole', enum_value: 'OWNER', sort_order: 1 },
        { enum_name: 'UserRole', enum_value: 'MEMBER', sort_order: 2 },
      ]);

      expect(checks.map(({ constraint_name }) => constraint_name).sort()).toEqual(
        [
          'AuditEvent_metadata_size_check',
          'AwardLine_gstBasisPoints_check',
          'AwardLine_gstPaise_check',
          'AwardLine_quantity_check',
          'AwardLine_subtotalPaise_check',
          'AwardLine_totalPaise_check',
          'AwardLine_unitRatePaise_check',
          'Award_deliverySnapshot_size_check',
          'Award_supplierSnapshots_size_check',
          'Award_totalPaise_check',
          'Ingredient_position_check',
          'Ingredient_quantity_check',
          'Invitation_expiry_check',
          'Invitation_tokenDigest_length_check',
          'Menu_version_check',
          'ProcurementRequest_deliveryDate_check',
          'ProcurementRequest_deliveryDetails_size_check',
          'ProcurementRequest_quoteDeadline_check',
          'ProcurementRequest_version_check',
          'RateLimitBucket_count_check',
          'RateLimitBucket_keyDigest_length_check',
          'Recipe_position_check',
          'RequestItem_quantity_check',
          'SupplierQuoteItem_availableQuantity_check',
          'SupplierQuoteItem_gstBasisPoints_check',
          'SupplierQuoteItem_gstPaise_check',
          'SupplierQuoteItem_line_total_check',
          'SupplierQuoteItem_quote_shape_check',
          'SupplierQuoteItem_subtotalPaise_check',
          'SupplierQuoteItem_totalPaise_check',
          'SupplierQuoteItem_unitRatePaise_check',
          'SupplierQuote_deliveryDate_check',
          'SupplierQuote_freightPaise_check',
          'SupplierQuote_gstPaise_check',
          'SupplierQuote_landed_total_check',
          'SupplierQuote_revision_check',
          'SupplierQuote_subtotalPaise_check',
          'SupplierQuote_totalPaise_check',
          'SupplierQuote_validUntil_check',
          'SupplierRequest_expiry_check',
          'SupplierRequest_tokenDigest_length_check',
          'User_email_lowercase_check',
        ].sort(),
      );
      expect(
        checks.find(
          ({ constraint_name }) =>
            constraint_name === 'Award_supplierSnapshots_size_check',
        ),
      ).toEqual(
        expect.objectContaining({
          table_name: 'Award',
          definition: expect.stringContaining('2097152'),
        }),
      );

      const quantityColumns = [
        ['Ingredient.quantity', 'NO'],
        ['RequestItem.quantity', 'NO'],
        ['SupplierQuoteItem.availableQuantity', 'YES'],
        ['AwardLine.quantity', 'NO'],
      ] as const;
      for (const [key, isNullable] of quantityColumns) {
        expect(columnsByKey.get(key)).toEqual(
          expect.objectContaining({
            data_type: 'numeric',
            is_nullable: isNullable,
            numeric_precision: 18,
            numeric_scale: 3,
          }),
        );
      }

      const expectedPaiseColumns = [
        'Award.totalPaise',
        'AwardLine.gstPaise',
        'AwardLine.subtotalPaise',
        'AwardLine.totalPaise',
        'AwardLine.unitRatePaise',
        'SupplierQuote.freightPaise',
        'SupplierQuote.gstPaise',
        'SupplierQuote.subtotalPaise',
        'SupplierQuote.totalPaise',
        'SupplierQuoteItem.gstPaise',
        'SupplierQuoteItem.subtotalPaise',
        'SupplierQuoteItem.totalPaise',
        'SupplierQuoteItem.unitRatePaise',
      ].sort();
      const actualPaiseColumns = columns
        .filter(({ column_name }) => column_name.endsWith('Paise'))
        .map(columnKey)
        .sort();
      expect(actualPaiseColumns).toEqual(expectedPaiseColumns);
      for (const key of expectedPaiseColumns) {
        expect(columnsByKey.get(key)).toEqual(
          expect.objectContaining({ data_type: 'bigint' }),
        );
      }

      for (const key of [
        'Invitation.tokenDigest',
        'SupplierRequest.tokenDigest',
        'RateLimitBucket.keyDigest',
      ]) {
        expect(columnsByKey.get(key)).toEqual(
          expect.objectContaining({
            data_type: 'character',
            character_maximum_length: 64,
            is_nullable: 'NO',
          }),
        );
      }

      for (const key of [
        'ProcurementRequest.deliveryDate',
        'SupplierQuote.deliveryDate',
        'SupplierQuote.validUntil',
      ]) {
        expect(columnsByKey.get(key)).toEqual(
          expect.objectContaining({ data_type: 'date', is_nullable: 'NO' }),
        );
      }

      const constraintKeys = new Set(constraints.map(constraintKey));
      const uniqueIndexKeys = new Set(
        uniqueIndexes.map(({ table_name, columns: indexColumns }) =>
          `${table_name}|${indexColumns.join(',')}`,
        ),
      );
      const requiredForeignKeys: Array<
        [string, string[], string, string[]]
      > = [
        ['User', ['tenantId'], 'Tenant', ['id']],
        ['ExternalIdentity', ['tenantId'], 'Tenant', ['id']],
        [
          'ExternalIdentity',
          ['tenantId', 'userId'],
          'User',
          ['tenantId', 'id'],
        ],
        ['Invitation', ['tenantId'], 'Tenant', ['id']],
        ['Invitation', ['tenantId', 'invitedByUserId'], 'User', ['tenantId', 'id']],
        ['Menu', ['tenantId'], 'Tenant', ['id']],
        ['Menu', ['tenantId', 'approvedByUserId'], 'User', ['tenantId', 'id']],
        ['Menu', ['tenantId', 'createdByUserId'], 'User', ['tenantId', 'id']],
        ['Recipe', ['tenantId'], 'Tenant', ['id']],
        ['Recipe', ['tenantId', 'menuId'], 'Menu', ['tenantId', 'id']],
        ['Ingredient', ['tenantId'], 'Tenant', ['id']],
        ['Ingredient', ['tenantId', 'recipeId'], 'Recipe', ['tenantId', 'id']],
        ['Supplier', ['tenantId'], 'Tenant', ['id']],
        ['ProcurementRequest', ['tenantId'], 'Tenant', ['id']],
        ['ProcurementRequest', ['tenantId', 'menuId'], 'Menu', ['tenantId', 'id']],
        [
          'ProcurementRequest',
          ['tenantId', 'sourceRequestId'],
          'ProcurementRequest',
          ['tenantId', 'id'],
        ],
        [
          'ProcurementRequest',
          ['tenantId', 'createdByUserId'],
          'User',
          ['tenantId', 'id'],
        ],
        ['RequestItem', ['tenantId'], 'Tenant', ['id']],
        [
          'RequestItem',
          ['tenantId', 'requestId'],
          'ProcurementRequest',
          ['tenantId', 'id'],
        ],
        ['SupplierRequest', ['tenantId'], 'Tenant', ['id']],
        [
          'SupplierRequest',
          ['tenantId', 'requestId'],
          'ProcurementRequest',
          ['tenantId', 'id'],
        ],
        [
          'SupplierRequest',
          ['tenantId', 'supplierId'],
          'Supplier',
          ['tenantId', 'id'],
        ],
        ['SupplierQuote', ['tenantId'], 'Tenant', ['id']],
        [
          'SupplierQuote',
          ['tenantId', 'supplierRequestId'],
          'SupplierRequest',
          ['tenantId', 'id'],
        ],
        ['SupplierQuoteItem', ['tenantId'], 'Tenant', ['id']],
        [
          'SupplierQuoteItem',
          ['tenantId', 'quoteId'],
          'SupplierQuote',
          ['tenantId', 'id'],
        ],
        [
          'SupplierQuoteItem',
          ['tenantId', 'requestItemId'],
          'RequestItem',
          ['tenantId', 'id'],
        ],
        ['Award', ['tenantId'], 'Tenant', ['id']],
        [
          'Award',
          ['tenantId', 'requestId'],
          'ProcurementRequest',
          ['tenantId', 'id'],
        ],
        ['Award', ['tenantId', 'awardedByUserId'], 'User', ['tenantId', 'id']],
        ['AwardLine', ['tenantId'], 'Tenant', ['id']],
        ['AwardLine', ['tenantId', 'awardId'], 'Award', ['tenantId', 'id']],
        [
          'AwardLine',
          ['tenantId', 'requestItemId'],
          'RequestItem',
          ['tenantId', 'id'],
        ],
        [
          'AwardLine',
          ['tenantId', 'supplierQuoteItemId'],
          'SupplierQuoteItem',
          ['tenantId', 'id'],
        ],
        ['AwardLine', ['tenantId', 'supplierId'], 'Supplier', ['tenantId', 'id']],
        ['AuditEvent', ['tenantId'], 'Tenant', ['id']],
        ['AuditEvent', ['tenantId', 'actorUserId'], 'User', ['tenantId', 'id']],
      ];
      for (const [table, keyColumns, foreignTable, foreignColumns] of requiredForeignKeys) {
        const prefix =
          `${table}|FOREIGN KEY|${keyColumns.join(',')}|` +
          `${foreignTable}|${foreignColumns.join(',')}|`;
        expect([...constraintKeys].some((key) => key.startsWith(prefix))).toBe(
          true,
        );
      }

      const requiredUniques: Array<[string, string[]]> = [
        ['User', ['email']],
        ['User', ['tenantId', 'id']],
        ['ExternalIdentity', ['tenantId', 'userId', 'provider']],
        ['Invitation', ['tokenDigest']],
        ['Menu', ['tenantId', 'id']],
        ['Recipe', ['tenantId', 'id']],
        ['Ingredient', ['tenantId', 'id']],
        ['Supplier', ['tenantId', 'id']],
        ['ProcurementRequest', ['tenantId', 'id']],
        ['RequestItem', ['tenantId', 'id']],
        ['SupplierRequest', ['tokenDigest']],
        ['SupplierRequest', ['tenantId', 'id']],
        ['SupplierRequest', ['tenantId', 'requestId', 'supplierId']],
        ['SupplierQuote', ['tenantId', 'id']],
        ['SupplierQuote', ['tenantId', 'supplierRequestId', 'revision']],
        ['SupplierQuoteItem', ['tenantId', 'id']],
        ['SupplierQuoteItem', ['tenantId', 'quoteId', 'requestItemId']],
        ['Award', ['requestId']],
        ['Award', ['tenantId', 'id']],
        ['Award', ['tenantId', 'requestId']],
        [
          'AwardLine',
          ['tenantId', 'awardId', 'requestItemId', 'supplierQuoteItemId'],
        ],
      ];
      for (const [table, uniqueColumns] of requiredUniques) {
        expect(uniqueIndexKeys.has(`${table}|${uniqueColumns.join(',')}`)).toBe(
          true,
        );
      }

      await prisma.$executeRawUnsafe(`
        INSERT INTO "Tenant" (
          "id", "name", "addressLine", "city", "state", "pin", "phone", "updatedAt"
        ) VALUES
          ('catalog-tenant-a', 'A', 'A', 'A', 'A', '000000', 'A', CURRENT_TIMESTAMP),
          ('catalog-tenant-b', 'B', 'B', 'B', 'B', '000000', 'B', CURRENT_TIMESTAMP)
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "User" (
          "id", "tenantId", "name", "email", "role", "updatedAt"
        ) VALUES
          ('catalog-user-a', 'catalog-tenant-a', 'A', 'a@example.test', 'OWNER', CURRENT_TIMESTAMP),
          ('catalog-user-b', 'catalog-tenant-b', 'B', 'b@example.test', 'OWNER', CURRENT_TIMESTAMP)
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Menu" (
          "id", "tenantId", "name", "status", "version", "createdByUserId", "updatedAt"
        ) VALUES
          ('catalog-menu-a', 'catalog-tenant-a', 'A', 'DRAFT', 1, 'catalog-user-a', CURRENT_TIMESTAMP)
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ExternalIdentity" (
          "tenantId", "userId", "provider", "providerAccountId"
        ) VALUES (
          'catalog-tenant-a', 'catalog-user-a', 'google', 'google-account-a'
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Supplier" (
          "id", "tenantId", "businessName", "updatedAt"
        ) VALUES
          ('catalog-supplier-a', 'catalog-tenant-a', 'A', CURRENT_TIMESTAMP)
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProcurementRequest" (
          "id", "tenantId", "title", "status", "version", "deliveryDetails",
          "deliveryDate", "quoteDeadline", "createdByUserId", "createdAt", "updatedAt"
        ) VALUES (
          'catalog-request-a', 'catalog-tenant-a', 'A', 'OPEN', 1, '{}'::JSONB,
          '2027-01-03', '2027-01-02', 'catalog-user-a', '2027-01-01', '2027-01-01'
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "RequestItem" (
          "id", "tenantId", "requestId", "name", "quantity", "unit"
        ) VALUES (
          'catalog-item-a', 'catalog-tenant-a', 'catalog-request-a', 'Rice', 1, 'KILOGRAM'
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "SupplierRequest" (
          "id", "tenantId", "requestId", "supplierId", "tokenDigest", "expiresAt", "createdAt"
        ) VALUES (
          'catalog-supplier-request-a', 'catalog-tenant-a', 'catalog-request-a',
          'catalog-supplier-a', repeat('a', 64), '2027-01-03', '2027-01-01'
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "SupplierQuote" (
          "id", "tenantId", "supplierRequestId", "revision", "subtotalPaise",
          "gstPaise", "freightPaise", "totalPaise", "deliveryDate", "validUntil", "submittedAt"
        ) VALUES (
          'catalog-quote-a', 'catalog-tenant-a', 'catalog-supplier-request-a', 1,
          100, 0, 0, 100, '2027-01-03', '2027-01-03', '2027-01-01'
        )
      `);

      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "Recipe" ("id", "tenantId", "menuId", "name", "position")
          VALUES ('cross-tenant-recipe', 'catalog-tenant-b', 'catalog-menu-a', 'Bad', 0)
        `),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "ExternalIdentity" (
            "tenantId", "userId", "provider", "providerAccountId"
          ) VALUES (
            'catalog-tenant-b', 'catalog-user-b', 'google', 'google-account-a'
          )
        `),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "ExternalIdentity" (
            "tenantId", "userId", "provider", "providerAccountId"
          ) VALUES (
            'catalog-tenant-b', 'catalog-user-a', 'google', 'google-account-b'
          )
        `),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "Invitation" (
            "id", "tenantId", "email", "tokenDigest", "expiresAt", "invitedByUserId", "createdAt"
          ) VALUES (
            'cross-tenant-invitation', 'catalog-tenant-b', 'invite@example.test',
            repeat('b', 64), '2027-01-03', 'catalog-user-a', '2027-01-01'
          )
        `),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "Award" (
            "id", "tenantId", "requestId", "supplierSnapshots", "deliverySnapshot",
            "totalPaise", "awardedByUserId"
          ) VALUES (
            'negative-award', 'catalog-tenant-a', 'catalog-request-a', '[]', '{}',
            -1, 'catalog-user-a'
          )
        `),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "SupplierQuoteItem" (
            "id", "tenantId", "quoteId", "requestItemId", "noQuote",
            "gstBasisPoints", "subtotalPaise", "gstPaise", "totalPaise"
          ) VALUES (
            'bad-gst-item', 'catalog-tenant-a', 'catalog-quote-a', 'catalog-item-a', false,
            10001, 100, 0, 100
          )
        `),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "RateLimitBucket" ("keyDigest", "count", "resetAt")
          VALUES ('short', 0, CURRENT_TIMESTAMP)
        `),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO "Award" (
            "id", "tenantId", "requestId", "supplierSnapshots", "deliverySnapshot",
            "totalPaise", "awardedByUserId"
          ) VALUES (
            'oversized-award', 'catalog-tenant-a', 'catalog-request-a',
            jsonb_build_object('payload', repeat('x', 2100000)), '{}', 0, 'catalog-user-a'
          )
        `),
      ).rejects.toThrow();

      const allColumnNames = columns.map(({ column_name }) => column_name);
      expect(allColumnNames).not.toEqual(
        expect.arrayContaining(['selectedSupplierIds', 'selectedIngredientIds']),
      );
      expect(tables.map(({ tablename }) => tablename).join(' ')).not.toMatch(
        /PricingTrend|Distributor|RFP|Quote$|ProcurementRun|Generated|Blob|Dashboard|Aggregate|Forecast|Vector|Embedding|Job|Email/i,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});
