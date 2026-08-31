import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { parseSupplierCsv } from '@/lib/suppliers/csv';
import {
  createSupplier,
  decideSupplierVerification,
  deactivateSupplier,
  getSupplier,
  importSupplierRows,
  listSuppliers,
  listSuppliersForExport,
  SupplierConflictError,
  SupplierNotFoundError,
  SupplierVerificationConflictError,
  updateSupplier,
} from '@/lib/suppliers/supplier-service';

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
  role: 'OWNER' | 'MEMBER' = 'MEMBER',
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
          role,
        },
      },
    },
  });
}

const supplierInput = (businessName: string, index: number) => ({
  businessName,
  contactName: `Contact ${index}`,
  phone: `98765${String(index).padStart(5, '0')}`,
  whatsappNumber: null,
  email: `sales${index}@supplier.in`,
  addressLine: `${index} APMC Market`,
  city: 'Navi Mumbai',
  state: 'Maharashtra',
  pin: '400705',
  gstin: '27AAPFU0939F1ZV',
  notes: null,
});

test('supplier CRUD, search, active filtering, and cursor pagination stay tenant scoped', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      await seedTenant(admin, 'tenant-b', 'member-b', 'b@example.test');
      app = await provisionAppClient(admin, databaseUrl);
      const actor = { tenantId: 'tenant-a', userId: 'member-a' };

      const alpha = await createSupplier(
        { actor, supplier: supplierInput('Alpha Produce', 1) },
        app,
      );
      const beta = await createSupplier(
        { actor, supplier: supplierInput('Beta Dairy', 2) },
        app,
      );
      const gamma = await createSupplier(
        { actor, supplier: supplierInput('Gamma Spices', 3) },
        app,
      );
      expect(alpha).toEqual(
        expect.objectContaining({
          tenantId: 'tenant-a',
          businessName: 'Alpha Produce',
          phone: '+919876500001',
          email: 'sales1@supplier.in',
          relationshipType: 'CURRENT',
          verificationStatus: 'VERIFIED',
          verifiedByUserId: 'member-a',
          verifiedAt: expect.any(Date),
          capabilities: { v: 1, categories: [], items: [] },
        }),
      );
      expect(await admin.auditEvent.count({ where: { action: 'supplier.created' } }))
        .toBe(3);

      const pageOne = await listSuppliers({ actor, active: 'all', limit: 2 }, app);
      expect(pageOne.suppliers[0]).not.toHaveProperty('capabilities');
      expect(pageOne.suppliers.map(({ id }) => id)).toEqual([alpha.id, beta.id]);
      expect(pageOne.nextCursor).toEqual(expect.any(String));
      const pageTwo = await listSuppliers(
        { actor, active: 'all', limit: 2, cursor: pageOne.nextCursor! },
        app,
      );
      expect(pageTwo.suppliers.map(({ id }) => id)).toEqual([gamma.id]);
      expect(pageTwo.nextCursor).toBeNull();

      const search = await listSuppliers(
        { actor, active: 'all', search: 'dairy', limit: 10 },
        app,
      );
      expect(search.suppliers.map(({ id }) => id)).toEqual([beta.id]);
      await expect(getSupplier({ actor, supplierId: alpha.id }, app)).resolves
        .toEqual(expect.objectContaining({ capabilities: { v: 1, categories: [], items: [] } }));

      const edited = await updateSupplier(
        {
          actor,
          supplierId: beta.id,
          changes: { businessName: 'Beta Dairy & Frozen', email: null },
        },
        app,
      );
      expect(edited).toEqual(
        expect.objectContaining({
          businessName: 'Beta Dairy & Frozen',
          email: null,
        }),
      );
      const inactive = await deactivateSupplier(
        { actor, supplierId: beta.id },
        app,
      );
      expect(inactive.isActive).toBe(false);
      expect(
        (await listSuppliers({ actor, active: true, limit: 10 }, app)).suppliers
          .map(({ id }) => id),
      ).toEqual([alpha.id, gamma.id]);
      expect(
        (await listSuppliers({ actor, active: false, limit: 10 }, app)).suppliers
          .map(({ id }) => id),
      ).toEqual([beta.id]);

      const tenantB = await admin.supplier.create({
        data: {
          tenantId: 'tenant-b',
          businessName: 'Private B Supplier',
          email: alpha.email,
          phone: alpha.phone,
          capabilities: { v: 1, categories: [], items: [] },
        },
      });
      await expect(getSupplier({ actor, supplierId: tenantB.id }, app)).rejects
        .toBeInstanceOf(SupplierNotFoundError);
      await expect(
        updateSupplier(
          { actor, supplierId: tenantB.id, changes: { businessName: 'Changed' } },
          app,
        ),
      ).rejects.toBeInstanceOf(SupplierNotFoundError);
      expect(await admin.supplier.findUniqueOrThrow({ where: { id: tenantB.id } }))
        .toEqual(expect.objectContaining({ businessName: 'Private B Supplier' }));

      await expect(
        createSupplier(
          {
            actor: { tenantId: 'tenant-a', userId: 'member-b' },
            supplier: supplierInput('Cross tenant actor', 4),
          },
          app,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});

test('tenant locking serializes normalized duplicate contacts and CSV import is all-or-nothing', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      app = await provisionAppClient(admin, databaseUrl);
      const actor = { tenantId: 'tenant-a', userId: 'member-a' };

      const race = await Promise.allSettled([
        createSupplier(
          {
            actor,
            supplier: {
              ...supplierInput('Race One', 10),
              email: ' SHARED@SUPPLIER.IN ',
              phone: '98765 11111',
            },
          },
          app,
        ),
        createSupplier(
          {
            actor,
            supplier: {
              ...supplierInput('Race Two', 11),
              email: 'shared@supplier.in',
              phone: '+91 98765 11111',
            },
          },
          app,
        ),
      ]);
      expect(race.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(race.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect((race.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason)
        .toBeInstanceOf(SupplierConflictError);
      expect(
        await admin.supplier.count({ where: { tenantId: 'tenant-a' } }),
      ).toBe(1);

      const rows = parseSupplierCsv(
        [
          'business_name,email,phone,city,state,pin,gstin',
          'Import One,unique@supplier.in,9876522222,Mumbai,Maharashtra,400001,27AAPFU0939F1ZV',
          'Import Conflict,shared@supplier.in,9876533333,Mumbai,Maharashtra,400001,27AAPFU0939F1ZV',
        ].join('\n'),
      );
      await expect(importSupplierRows({ actor, rows }, app)).rejects.toMatchObject({
        code: 'CSV_CONFLICT',
        status: 422,
        errors: [
          expect.objectContaining({ row: 3, field: 'email', code: 'duplicate' }),
        ],
      });
      expect(
        await admin.supplier.count({ where: { tenantId: 'tenant-a' } }),
      ).toBe(1);

      const validRows = parseSupplierCsv(
        [
          'business_name,email,phone,city,state,pin,gstin',
          'Import One,unique@supplier.in,9876522222,Mumbai,Maharashtra,400001,27AAPFU0939F1ZV',
          'Import Two,second@supplier.in,9876533333,Pune,Maharashtra,411001,27AAPFU0939F1ZV',
        ].join('\n'),
      );
      await expect(importSupplierRows({ actor, rows: validRows }, app)).resolves
        .toEqual({ importedCount: 2 });
      expect(
        await admin.supplier.count({ where: { tenantId: 'tenant-a' } }),
      ).toBe(3);
      expect(await admin.supplier.count({
        where: {
          tenantId: 'tenant-a',
          verificationStatus: 'VERIFIED',
          verifiedByUserId: 'member-a',
          capabilities: { equals: { v: 1, categories: [], items: [] } },
        },
      })).toBe(3);

      await expect(
        updateSupplier(
          {
            actor,
            supplierId: (
              await admin.supplier.findFirstOrThrow({
                where: { tenantId: 'tenant-a', email: 'unique@supplier.in' },
              })
            ).id,
            changes: { email: 'SHARED@SUPPLIER.IN' },
          },
          app,
        ),
      ).rejects.toBeInstanceOf(SupplierConflictError);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});

test('supplier cursors include unseen renames once, do not repeat seen renames, exclude later creates, and reject filter changes', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      app = await provisionAppClient(admin, databaseUrl);
      const actor = { tenantId: 'tenant-a', userId: 'member-a' };
      const alpha = await createSupplier(
        { actor, supplier: supplierInput('Alpha Produce', 30) },
        app,
      );
      const beta = await createSupplier(
        { actor, supplier: supplierInput('Beta Dairy', 31) },
        app,
      );
      const gamma = await createSupplier(
        { actor, supplier: supplierInput('Gamma Spices', 32) },
        app,
      );

      const pageOne = await listSuppliers({ actor, active: 'all', limit: 1 }, app);
      expect(pageOne.suppliers.map(({ id }) => id)).toEqual([alpha.id]);
      expect(pageOne.nextCursor).toEqual(expect.any(String));

      await new Promise((resolve) => setTimeout(resolve, 5));
      await updateSupplier(
        {
          actor,
          supplierId: alpha.id,
          changes: { businessName: 'Zulu Seen Produce' },
        },
        app,
      );
      await updateSupplier(
        {
          actor,
          supplierId: gamma.id,
          changes: { businessName: 'Aardvark Spices' },
        },
        app,
      );
      const afterSnapshot = await createSupplier(
        { actor, supplier: supplierInput('Zulu New Supplier', 33) },
        app,
      );

      const continuationIds: string[] = [];
      let cursor: string | null = pageOne.nextCursor;
      while (cursor) {
        const page = await listSuppliers(
          { actor, active: 'all', limit: 1, cursor },
          app,
        );
        continuationIds.push(...page.suppliers.map(({ id }) => id));
        cursor = page.nextCursor;
      }
      expect(continuationIds).toEqual([beta.id, gamma.id]);
      expect(continuationIds.filter((id) => id === alpha.id)).toHaveLength(0);
      expect(continuationIds.filter((id) => id === gamma.id)).toHaveLength(1);
      expect(continuationIds).not.toContain(afterSnapshot.id);

      await expect(
        listSuppliers(
          { actor, active: true, limit: 2, cursor: pageOne.nextCursor! },
          app,
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_SUPPLIER',
        status: 422,
        errors: { cursor: ['Cursor does not match these supplier filters.'] },
      });
      await expect(
        listSuppliers(
          {
            actor,
            active: 'all',
            search: 'produce',
            limit: 2,
            cursor: pageOne.nextCursor!,
          },
          app,
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_SUPPLIER',
        status: 422,
        errors: { cursor: ['Cursor does not match these supplier filters.'] },
      });

      const fresh = await listSuppliers({ actor, active: 'all', limit: 10 }, app);
      expect(fresh.suppliers.map(({ businessName }) => businessName)).toEqual([
        'Zulu Seen Produce',
        'Beta Dairy',
        'Aardvark Spices',
        'Zulu New Supplier',
      ]);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});

test('only an owner can approve or reject a pending tenant applicant once', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await seedTenant(admin, 'tenant-a', 'owner-a', 'owner-a@example.test', 'OWNER');
      await seedTenant(admin, 'tenant-b', 'owner-b', 'owner-b@example.test', 'OWNER');
      await admin.user.create({
        data: {
          id: 'member-a', tenantId: 'tenant-a', name: 'Member A',
          email: 'member-a@example.test', role: 'MEMBER',
        },
      });
      app = await provisionAppClient(admin, databaseUrl);
      const requestA = await admin.procurementRequest.create({
        data: {
          tenantId: 'tenant-a',
          title: 'Tenant A request',
          status: 'OPEN',
          items: { v: 1, items: [] },
          sourcing: { v: 1, default: { modes: ['VERIFIED_NEW'] } },
          deliveryDetails: { address: '1 Market Road' },
          deliveryDate: new Date('2027-01-03T00:00:00.000Z'),
          quoteDeadline: new Date('2027-01-02T10:00:00.000Z'),
          createdByUserId: 'owner-a',
        },
      });
      const requestB = await admin.procurementRequest.create({
        data: {
          tenantId: 'tenant-b', title: 'Tenant B request', status: 'OPEN',
          items: { v: 1, items: [] }, sourcing: { v: 1, default: { modes: ['VERIFIED_NEW'] } },
          deliveryDetails: {}, deliveryDate: new Date('2027-01-03T00:00:00.000Z'),
          quoteDeadline: new Date('2027-01-02T10:00:00.000Z'), createdByUserId: 'owner-b',
        },
      });
      const applicant = (tenantId: string, requestId: string, name: string) =>
        admin.supplier.create({ data: {
          tenantId, businessName: name, relationshipType: 'APPLICANT',
          verificationStatus: 'PENDING', applicationRequestId: requestId,
          capabilities: { v: 1, categories: [], items: [] }, isActive: false,
        } });
      const approve = await applicant('tenant-a', requestA.id, 'Approve Me');
      const reject = await applicant('tenant-a', requestA.id, 'Reject Me');
      const memberBlocked = await applicant('tenant-a', requestA.id, 'Member Blocked');
      const tenantB = await applicant('tenant-b', requestB.id, 'Tenant B');

      await expect(decideSupplierVerification({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
        supplierId: memberBlocked.id, decision: 'APPROVE',
      }, app)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(decideSupplierVerification({
        actor: { tenantId: 'tenant-a', userId: 'owner-a' },
        supplierId: tenantB.id, decision: 'APPROVE',
      }, app)).rejects.toBeInstanceOf(SupplierNotFoundError);

      await expect(decideSupplierVerification({
        actor: { tenantId: 'tenant-a', userId: 'owner-a' },
        supplierId: approve.id, decision: 'APPROVE',
      }, app)).resolves.toEqual(expect.objectContaining({
        relationshipType: 'SELECTED_NEW', verificationStatus: 'VERIFIED',
        isActive: true, verifiedByUserId: 'owner-a', verifiedAt: expect.any(Date),
      }));
      await expect(decideSupplierVerification({
        actor: { tenantId: 'tenant-a', userId: 'owner-a' },
        supplierId: reject.id, decision: 'REJECT',
      }, app)).resolves.toEqual(expect.objectContaining({
        relationshipType: 'APPLICANT', verificationStatus: 'REJECTED',
        isActive: false, verifiedAt: null,
      }));
      await expect(decideSupplierVerification({
        actor: { tenantId: 'tenant-a', userId: 'owner-a' },
        supplierId: approve.id, decision: 'APPROVE',
      }, app)).rejects.toBeInstanceOf(SupplierVerificationConflictError);
      await expect(updateSupplier({
        actor: { tenantId: 'tenant-a', userId: 'owner-a' },
        supplierId: memberBlocked.id, changes: { isActive: true },
      }, app)).rejects.toBeInstanceOf(SupplierVerificationConflictError);
      for (const [supplierId, changes] of [
        [memberBlocked.id, { businessName: 'Private pending edit' }],
        [reject.id, { capabilities: {
          v: 1 as const,
          categories: [{ category: 'FRUITS' as const, tier: 'CAPABLE' as const, rank: 1 }],
          items: [],
        } }],
      ] as const) {
        await expect(updateSupplier({
          actor: { tenantId: 'tenant-a', userId: 'owner-a' },
          supplierId,
          changes,
        }, app)).rejects.toBeInstanceOf(SupplierVerificationConflictError);
      }
      expect((await listSuppliersForExport({
        actor: { tenantId: 'tenant-a', userId: 'owner-a' }, active: 'all',
      }, app)).suppliers.map(({ id }) => id)).toEqual([approve.id]);
      expect(await admin.auditEvent.count({ where: {
        tenantId: 'tenant-a', action: { in: ['supplier.verified', 'supplier.rejected'] },
      } })).toBe(2);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
