import { PrismaClient } from '@prisma/client';

import { checkRuntimeDatabase } from '@/lib/health/readiness';

import { withMigratedPostgres } from './setup/postgres';

const applicationTables =
  'AuditEvent Award Menu ProcurementRequest RateLimitBucket Supplier SupplierRequest Tenant User'.split(
    ' ',
  );
const expectedColumns: Record<string, string> = {
  AuditEvent: 'id tenantId actorUserId action entityType entityId metadata createdAt',
  Award: 'id tenantId requestId rationale allocationLines supplierSnapshots deliverySnapshot totalPaise awardedByUserId createdAt',
  Menu: 'id tenantId name sourceText status version approvedAt approvedByUserId createdByUserId createdAt updatedAt document',
  ProcurementRequest: 'id tenantId title status version menuId sourceRequestId deliveryDetails deliveryDate quoteDeadline commercialTerms openedAt awardedAt cancelledAt createdByUserId createdAt updatedAt items sourcing applicationTokenDigest applicationExpiresAt applicationRevokedAt',
  RateLimitBucket: 'keyDigest count resetAt',
  Supplier: 'id tenantId businessName contactName phone whatsappNumber email addressLine city state pin gstin notes isActive createdAt updatedAt relationshipType verificationStatus applicationRequestId capabilities verifiedAt verifiedByUserId',
  SupplierRequest: 'id tenantId requestId supplierId tokenDigest expiresAt revokedAt viewedAt createdAt quoteRevision quoteRevisions updatedAt',
  Tenant: 'id name addressLine city state pin phone timezone gstin isActive createdAt updatedAt',
  User: 'id tenantId name email passwordHash role isActive lastLoginAt createdAt updatedAt googleSubject accountState invitationTokenDigest invitationExpiresAt invitationAcceptedAt invitationRevokedAt invitedByUserId tutorialVersion tutorialStep tutorialSkippedAt tutorialCompletedAt',
};
const requiredFunctions =
  'autorfp_auth_credentials_by_email autorfp_auth_identity_by_email autorfp_auth_identity_by_google_subject autorfp_invitation_tenant_by_digest autorfp_supplier_application_grant_by_digest autorfp_supplier_grant_by_digest autorfp_user_email_exists'.split(
  ' ',
  );
test('compact catalog keeps nine bounded tables and fixed digest grants', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_catalog.pg_tables
        WHERE schemaname = 'public' ORDER BY tablename
      `;
      expect(tables.map(({ tablename }) => tablename)).toEqual(
        [...applicationTables, '_prisma_migrations'].sort(),
      );
      const columns = await prisma.$queryRaw<
        Array<{
          table_name: string;
          column_name: string;
          udt_name: string;
          is_nullable: 'YES' | 'NO';
          character_maximum_length: number | null;
        }>
      >`
        SELECT table_name, column_name, udt_name, is_nullable,
               character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
        ORDER BY table_name, ordinal_position
      `;
      for (const table of applicationTables) {
        expect(
          columns.filter((row) => row.table_name === table)
            .map((row) => row.column_name).sort(),
        ).toEqual(expectedColumns[table].split(' ').sort());
      }
      const byColumn = new Map(
        columns.map((row) => [`${row.table_name}.${row.column_name}`, row]),
      );
      for (const key of [
        'Menu.document', 'Supplier.capabilities', 'ProcurementRequest.items',
        'ProcurementRequest.sourcing', 'ProcurementRequest.deliveryDetails',
        'SupplierRequest.quoteRevisions', 'Award.allocationLines',
        'Award.supplierSnapshots', 'Award.deliverySnapshot', 'AuditEvent.metadata',
      ]) expect(byColumn.get(key)?.udt_name).toBe('jsonb');
      for (const [key, nullable] of [
        ['User.invitationTokenDigest', 'YES'],
        ['ProcurementRequest.applicationTokenDigest', 'YES'],
        ['SupplierRequest.tokenDigest', 'NO'],
        ['RateLimitBucket.keyDigest', 'NO'],
      ]) {
        expect(byColumn.get(key)).toEqual(expect.objectContaining({
          udt_name: 'bpchar', is_nullable: nullable,
          character_maximum_length: 64,
        }));
      }
      expect(byColumn.get('User.email')).toEqual(expect.objectContaining({
        udt_name: 'varchar', character_maximum_length: 320,
      }));
      expect(byColumn.get('ProcurementRequest.deliveryDate')?.udt_name).toBe('date');
      expect(byColumn.get('Award.totalPaise')?.udt_name).toBe('int8');
      expect(byColumn.has('RateLimitBucket.tenantId')).toBe(false);
      const enums = await prisma.$queryRaw<
        Array<{ name: string; values: string[] }>
      >`
        SELECT type.typname AS name,
               array_agg(value.enumlabel ORDER BY value.enumsortorder)::TEXT[] AS values
        FROM pg_catalog.pg_type AS type
        JOIN pg_catalog.pg_enum AS value ON value.enumtypid = type.oid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = 'public'
        GROUP BY type.typname ORDER BY type.typname
      `;
      expect(enums).toEqual([
        { name: 'MenuStatus', values: ['DRAFT', 'APPROVED'] },
        { name: 'ProcurementRequestStatus', values: ['DRAFT', 'OPEN', 'AWARDED', 'CANCELLED'] },
        { name: 'SupplierRelationshipType', values: ['CURRENT', 'SELECTED_NEW', 'DISCOVERED'] },
        { name: 'SupplierVerificationStatus', values: ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'] },
        { name: 'UserAccountState', values: ['INVITED', 'ACTIVE', 'DEACTIVATED'] },
        { name: 'UserRole', values: ['OWNER', 'MEMBER'] },
      ]);
      const checks = await prisma.$queryRaw<
        Array<{ name: string; definition: string }>
      >`
        SELECT constraint_catalog.conname AS name,
               pg_get_constraintdef(constraint_catalog.oid) AS definition
        FROM pg_catalog.pg_constraint AS constraint_catalog
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = constraint_catalog.connamespace
        WHERE namespace.nspname = 'public' AND constraint_catalog.contype = 'c'
      `;
      const caps: Record<string, number> = {
        AuditEvent_metadata_size_check: 16384,
        Award_allocationLines_size_check: 2097152,
        Award_deliverySnapshot_size_check: 16384,
        Award_supplierSnapshots_size_check: 2097152,
        Menu_document_size_check: 524288,
        ProcurementRequest_deliveryDetails_size_check: 16384,
        ProcurementRequest_items_size_check: 524288,
        ProcurementRequest_sourcing_size_check: 65536,
        Supplier_capabilities_size_check: 65536,
        SupplierRequest_quoteRevisions_size_check: 2097152,
      };
      for (const [name, cap] of Object.entries(caps)) {
        expect(checks.find((check) => check.name === name)?.definition)
          .toMatch(new RegExp(`octet_length.*${cap}`));
      }
      expect(checks.map(({ name }) => name)).toEqual(expect.arrayContaining([
        'Award_totalPaise_check', 'Menu_version_check',
        'ProcurementRequest_version_check', 'RateLimitBucket_count_check',
        'SupplierRequest_quoteRevision_check', 'User_tutorialStep_check',
      ]));

      const foreignKeys = await prisma.$queryRaw<Array<{ path: string }>>`
        SELECT format('%s|%s|%s|%s', child.relname,
          array_to_string(array_agg(child_column.attname ORDER BY pair.ordinality), ','),
          parent.relname,
          array_to_string(array_agg(parent_column.attname ORDER BY pair.ordinality), ',')) AS path
        FROM pg_catalog.pg_constraint AS constraint_catalog
        JOIN pg_catalog.pg_class AS child ON child.oid = constraint_catalog.conrelid
        JOIN pg_catalog.pg_class AS parent ON parent.oid = constraint_catalog.confrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = child.relnamespace
        CROSS JOIN LATERAL unnest(constraint_catalog.conkey, constraint_catalog.confkey)
          WITH ORDINALITY AS pair(child_attnum, parent_attnum, ordinality)
        JOIN pg_catalog.pg_attribute AS child_column
          ON child_column.attrelid = child.oid AND child_column.attnum = pair.child_attnum
        JOIN pg_catalog.pg_attribute AS parent_column
          ON parent_column.attrelid = parent.oid AND parent_column.attnum = pair.parent_attnum
        WHERE namespace.nspname = 'public' AND constraint_catalog.contype = 'f'
        GROUP BY child.relname, parent.relname, constraint_catalog.oid
      `;
      const fkPaths = foreignKeys.map(({ path }) => path);
      for (const path of [
        'User|tenantId,invitedByUserId|User|tenantId,id',
        'Menu|tenantId,approvedByUserId|User|tenantId,id',
        'Menu|tenantId,createdByUserId|User|tenantId,id',
        'Supplier|tenantId,applicationRequestId|ProcurementRequest|tenantId,id',
        'Supplier|tenantId,verifiedByUserId|User|tenantId,id',
        'ProcurementRequest|tenantId,menuId|Menu|tenantId,id',
        'ProcurementRequest|tenantId,sourceRequestId|ProcurementRequest|tenantId,id',
        'ProcurementRequest|tenantId,createdByUserId|User|tenantId,id',
        'SupplierRequest|tenantId,requestId|ProcurementRequest|tenantId,id',
        'SupplierRequest|tenantId,supplierId|Supplier|tenantId,id',
        'Award|tenantId,requestId|ProcurementRequest|tenantId,id',
        'Award|tenantId,awardedByUserId|User|tenantId,id',
        'AuditEvent|tenantId,actorUserId|User|tenantId,id',
      ]) expect(fkPaths).toContain(path);

      const indexes = await prisma.$queryRaw<Array<{ path: string }>>`
        SELECT format('%s|%s', table_catalog.relname,
          array_to_string(array_agg(attribute.attname ORDER BY key.ordinality), ',')) AS path
        FROM pg_catalog.pg_index AS index_catalog
        JOIN pg_catalog.pg_class AS table_catalog ON table_catalog.oid = index_catalog.indrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_catalog.relnamespace
        CROSS JOIN LATERAL unnest(index_catalog.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = table_catalog.oid AND attribute.attnum = key.attnum
        WHERE namespace.nspname = 'public' AND NOT index_catalog.indisprimary
        GROUP BY table_catalog.relname, index_catalog.indexrelid
      `;
      const indexPaths = indexes.map(({ path }) => path);
      expect(indexPaths).toEqual(expect.arrayContaining([
        'Menu|tenantId,status,updatedAt', 'ProcurementRequest|tenantId,status,updatedAt',
        'ProcurementRequest|tenantId,createdAt', 'Supplier|tenantId,isActive,businessName',
        'Award|tenantId,createdAt', 'AuditEvent|tenantId,createdAt',
        'SupplierRequest|tenantId,requestId,supplierId',
      ]));
      for (const table of applicationTables.filter(
        (table) => !['Tenant', 'RateLimitBucket'].includes(table),
      )) expect(indexPaths).toContain(`${table}|tenantId,id`);

      const functions = await prisma.$queryRaw<
        Array<{ name: string; security_definer: boolean; settings: string[] }>
      >`
        SELECT procedure.proname AS name, procedure.prosecdef AS security_definer,
               procedure.proconfig::TEXT[] AS settings
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'autorfp_private' ORDER BY procedure.proname
      `;
      expect(functions).toEqual(requiredFunctions.map((name) => ({
        name, security_definer: true, settings: ['search_path=pg_catalog'],
      })));
      await prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe('SET LOCAL ROLE autorfp_app');
        await checkRuntimeDatabase(transaction);
      });

      for (const statement of [
        `INSERT INTO "Tenant" ("id", "name", "addressLine", "city", "state", "pin", "phone", "updatedAt") VALUES ('compact-tenant-a', 'A', 'A', 'A', 'A', '000000', 'A', CURRENT_TIMESTAMP), ('compact-tenant-b', 'B', 'B', 'B', 'B', '000000', 'B', CURRENT_TIMESTAMP)`,
        `INSERT INTO "User" ("id", "tenantId", "name", "email", "role", "accountState", "updatedAt") VALUES ('compact-user-a', 'compact-tenant-a', 'A', 'a@example.test', 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP), ('compact-user-b', 'compact-tenant-b', 'B', 'b@example.test', 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP)`,
        `INSERT INTO "Menu" ("id", "tenantId", "name", "status", "version", "document", "createdByUserId", "updatedAt") VALUES ('compact-menu-a', 'compact-tenant-a', 'A', 'DRAFT', 1, '{}', 'compact-user-a', CURRENT_TIMESTAMP)`,
        `INSERT INTO "ProcurementRequest" ("id", "tenantId", "title", "status", "version", "items", "sourcing", "deliveryDetails", "deliveryDate", "quoteDeadline", "applicationTokenDigest", "applicationExpiresAt", "createdByUserId", "createdAt", "updatedAt") VALUES ('compact-request-a', 'compact-tenant-a', 'A', 'OPEN', 1, '[]', '{"v":1,"default":{"v":1,"modes":["VERIFIED_NEW"],"currentSupplierIds":[],"selectedNewSupplierIds":[],"acceptVerifiedApplications":true}}', '{}', CURRENT_DATE + 2, CURRENT_TIMESTAMP + INTERVAL '1 day', repeat('a', 64), CURRENT_TIMESTAMP + INTERVAL '1 day', 'compact-user-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ]) await prisma.$executeRawUnsafe(statement);
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "Supplier" ("id", "tenantId", "businessName", "relationshipType", "verificationStatus", "applicationRequestId", "capabilities", "updatedAt")
        VALUES ('cross-tenant', 'compact-tenant-b', 'Bad', 'DISCOVERED', 'UNVERIFIED', 'compact-request-a', '{}', CURRENT_TIMESTAMP)
      `)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "Menu" SET "document" = jsonb_build_object('payload', repeat('x', 524289))
        WHERE "id" = 'compact-menu-a'
      `)).rejects.toThrow();

      const applicationGrant = () => prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe('SET LOCAL ROLE autorfp_app');
        return transaction.$queryRawUnsafe(`
          SELECT * FROM autorfp_private.autorfp_supplier_application_grant_by_digest(repeat('a', 64))
        `);
      });
      await expect(applicationGrant()).resolves.toEqual([
        { tenantId: 'compact-tenant-a', requestId: 'compact-request-a' },
      ]);
      for (const sourcing of [
        '{"v":1,"default":{"v":1,"modes":["CURRENT"],"acceptVerifiedApplications":true}}',
        '{"v":1,"default":{"v":1,"modes":["VERIFIED_NEW"],"acceptVerifiedApplications":"true"}}',
        '{"v":1,"default":{"v":1,"acceptVerifiedApplications":true}}',
      ]) {
        await prisma.$executeRawUnsafe(
          `UPDATE "ProcurementRequest" SET "sourcing" = $1::JSONB WHERE "id" = 'compact-request-a'`,
          sourcing,
        );
        await expect(applicationGrant()).resolves.toEqual([]);
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
