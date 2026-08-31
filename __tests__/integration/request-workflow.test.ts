import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  createProcurementRequestDraft,
  getProcurementRequest,
  listProcurementRequests,
  openProcurementRequest,
  ProcurementRequestConflictError,
  ProcurementRequestNotFoundError,
  repeatProcurementRequest,
  updateProcurementRequestDraft,
} from '@/lib/procurement/request-service';
import { digestOpaqueToken } from '@/lib/security/tokens';

import { withMigratedPostgres } from './setup/postgres';

const emptyCapabilities = { v: 1, categories: [], items: [] };
const emptyQuoteRevisions = { v: 1, revisions: [] };
const deliveryDetails = {
  addressLine: '12, 100 Feet Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560038',
  instructions: 'Deliver before 8:00 AM.',
};
const specification = {
  v: 1,
  category: 'DAIRY',
  description: 'Unsalted table butter',
  preferredBrand: null,
  packSize: '500 g',
  qualityGrade: null,
  notes: null,
  referenceUrl: null,
  thumbnailWebpBase64: null,
};

const currentAndVerified = {
  v: 1,
  modes: ['CURRENT', 'VERIFIED_NEW'],
  currentSupplierIds: ['supplier-current'],
  selectedNewSupplierIds: [],
  acceptVerifiedApplications: true,
} as const;

const selectedNewOnly = {
  v: 1,
  modes: ['SELECTED_NEW'],
  currentSupplierIds: [],
  selectedNewSupplierIds: ['supplier-selected'],
  acceptVerifiedApplications: false,
} as const;

function menuDocument(name = 'Butter') {
  return {
    v: 1,
    source: { kind: 'MANUAL', canonicalUrl: null, permissionConfirmed: true },
    dishes: [{
      id: 'dish1',
      name: 'Dal makhani',
      position: 0,
      ingredients: [
        {
          id: 'item1', itemKey: 'butter', name,
          quantity: '4.25', unit: 'KILOGRAM', specification,
        },
        {
          id: 'item2', itemKey: 'butter', name: 'Butter garnish',
          quantity: '1.125', unit: 'KILOGRAM',
          specification: { ...specification, description: 'Finishing butter' },
        },
      ],
    }],
  };
}

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
  input: { tenantId: string; userId: string; email: string },
) {
  await admin.tenant.create({
    data: {
      id: input.tenantId,
      name: `${input.tenantId} Kitchen`,
      addressLine: '12, 100 Feet Road',
      city: 'Bengaluru', state: 'Karnataka', pin: '560038', phone: '9000000000',
      users: {
        create: {
          id: input.userId,
          name: `${input.userId} Member`,
          email: input.email,
          role: 'MEMBER',
        },
      },
    },
  });
}

async function createApprovedMenu(
  admin: PrismaClient,
  input: { tenantId: string; userId: string; menuId: string },
) {
  return admin.menu.create({
    data: {
      id: input.menuId,
      tenantId: input.tenantId,
      name: 'Reviewed weekly menu',
      status: 'APPROVED',
      version: 3,
      document: menuDocument(),
      approvedAt: new Date('2098-12-30T10:00:00.000Z'),
      approvedByUserId: input.userId,
      createdByUserId: input.userId,
    },
  });
}

function rawTokenFrom(value: string, pathname: string) {
  const url = new URL(value);
  expect(url.origin).toBe('https://app.quoteplate.example');
  expect(url.pathname).toBe(pathname);
  expect(url.search).toBe('');
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return token!;
}

describe('restricted compact procurement request workflow', () => {
  jest.setTimeout(120_000);

  it('snapshots an approved menu, synchronizes mixed sourcing, and stores only public-token digests', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let app: PrismaClient | undefined;
      try {
        await seedTenant(admin, {
          tenantId: 'tenant-a', userId: 'member-a', email: 'member-a@example.test',
        });
        await seedTenant(admin, {
          tenantId: 'tenant-b', userId: 'member-b', email: 'member-b@example.test',
        });
        await createApprovedMenu(admin, {
          tenantId: 'tenant-a', userId: 'member-a', menuId: 'menu-a',
        });
        await createApprovedMenu(admin, {
          tenantId: 'tenant-b', userId: 'member-b', menuId: 'menu-b',
        });
        const verifiedAt = new Date('2098-12-30T11:00:00.000Z');
        await admin.supplier.createMany({
          data: [
            {
              id: 'supplier-current', tenantId: 'tenant-a', businessName: 'Current Foods',
              relationshipType: 'CURRENT', verificationStatus: 'VERIFIED',
              verifiedAt, verifiedByUserId: 'member-a', isActive: true,
              capabilities: emptyCapabilities,
            },
            {
              id: 'supplier-current-2', tenantId: 'tenant-a', businessName: 'Second Foods',
              relationshipType: 'CURRENT', verificationStatus: 'VERIFIED',
              verifiedAt, verifiedByUserId: 'member-a', isActive: true,
              capabilities: emptyCapabilities,
            },
            {
              id: 'supplier-selected', tenantId: 'tenant-a', businessName: 'Selected New Foods',
              relationshipType: 'SELECTED_NEW', verificationStatus: 'VERIFIED',
              verifiedAt, verifiedByUserId: 'member-a', isActive: true,
              capabilities: emptyCapabilities,
            },
            {
              id: 'supplier-private', tenantId: 'tenant-b', businessName: 'Private Foods',
              relationshipType: 'CURRENT', verificationStatus: 'VERIFIED',
              verifiedAt, verifiedByUserId: 'member-b', isActive: true,
              capabilities: emptyCapabilities,
            },
          ],
        });
        app = await provisionAppClient(admin, databaseUrl);
        const actor = { tenantId: 'tenant-a', userId: 'member-a' };
        const otherActor = { tenantId: 'tenant-b', userId: 'member-b' };
        const now = new Date('2098-12-31T09:00:00.000Z');
        const options = {
          now: () => now,
          transactionClock: async () => now,
          shareBaseUrl: 'https://app.quoteplate.example',
        };

        const created = await createProcurementRequestDraft({
          actor,
          draft: {
            title: 'Weekly butter request',
            menuId: 'menu-a',
            selectedItemIds: ['item1', 'item2'],
            defaultSourcing: currentAndVerified,
            sourcingOverrides: { item2: selectedNewOnly },
            deliveryDetails,
            deliveryDate: '2099-01-03',
            quoteDeadline: '2099-01-02T10:00:00.000Z',
            commercialTerms: 'Payment in 15 days.',
          },
        }, app, options);

        expect(created).toEqual(expect.objectContaining({
          tenantId: 'tenant-a', status: 'DRAFT', version: 1, menuId: 'menu-a',
          items: {
            v: 1,
            items: [
              expect.objectContaining({
                id: 'item1', itemKey: 'butter', name: 'Butter', quantity: '4.25',
                specification: expect.objectContaining({ packSize: '500 g' }),
                sourcingOverride: null,
              }),
              expect.objectContaining({ id: 'item2', sourcingOverride: selectedNewOnly }),
            ],
          },
          sourcing: { v: 1, default: currentAndVerified },
        }));
        expect(created).not.toHaveProperty('applicationTokenDigest');
        expect(created.supplierRequests).toHaveLength(2);
        expect(created.supplierRequests[0]).not.toHaveProperty('tokenDigest');
        expect(created.supplierRequests[0]).not.toHaveProperty('quoteRevisions');
        expect(await admin.supplierRequest.findMany({
          where: { requestId: created.id },
          orderBy: { supplierId: 'asc' },
          select: { supplierId: true, quoteRevision: true, quoteRevisions: true },
        })).toEqual([
          { supplierId: 'supplier-current', quoteRevision: 0, quoteRevisions: emptyQuoteRevisions },
          { supplierId: 'supplier-selected', quoteRevision: 0, quoteRevisions: emptyQuoteRevisions },
        ]);

        const widenedSourcing = {
          v: 1 as const,
          default: {
            ...currentAndVerified,
            currentSupplierIds: ['supplier-current', 'supplier-current-2'],
          },
        };
        const widened = await updateProcurementRequestDraft({
          actor, requestId: created.id, expectedVersion: 1,
          patch: { sourcing: widenedSourcing },
        }, app, options);
        expect(widened.version).toBe(2);
        expect(widened.supplierRequests).toHaveLength(3);
        const narrowed = await updateProcurementRequestDraft({
          actor, requestId: created.id, expectedVersion: 2,
          patch: { sourcing: { v: 1, default: currentAndVerified } },
        }, app, options);
        expect(narrowed.version).toBe(3);
        expect(narrowed.supplierRequests.map(({ supplierId }) => supplierId).sort())
          .toEqual(['supplier-current', 'supplier-selected']);

        await admin.menu.update({
          where: { id: 'menu-a' },
          data: { document: menuDocument('Changed after snapshot') },
        });
        await expect(getProcurementRequest({ actor, requestId: created.id }, app))
          .resolves.toEqual(expect.objectContaining({
            items: expect.objectContaining({
              items: expect.arrayContaining([
                expect.objectContaining({ id: 'item1', name: 'Butter', quantity: '4.25' }),
              ]),
            }),
          }));

        const listed = await listProcurementRequests({ actor }, app);
        expect(listed.requests).toEqual([
          expect.objectContaining({ id: created.id, itemCount: 2, supplierCount: 2 }),
        ]);
        for (const field of [
          'items', 'sourcing', 'deliveryDetails', 'deliveryDate', 'commercialTerms',
          'applicationTokenDigest', 'applicationExpiresAt',
        ]) expect(listed.requests[0]).not.toHaveProperty(field);
        await expect(getProcurementRequest({ actor: otherActor, requestId: created.id }, app))
          .rejects.toBeInstanceOf(ProcurementRequestNotFoundError);
        expect((await listProcurementRequests({ actor: otherActor }, app)).requests).toEqual([]);

        const beforeOpenDigests = await admin.supplierRequest.findMany({
          where: { requestId: created.id }, orderBy: { supplierId: 'asc' },
          select: { tokenDigest: true },
        });
        const opened = await openProcurementRequest({
          actor, requestId: created.id, expectedVersion: 3,
        }, app, options);
        expect(opened.request).toEqual(expect.objectContaining({ status: 'OPEN', version: 4 }));
        expect(opened.links).toHaveLength(2);
        const supplierTokens = opened.links.map(({ url }) => rawTokenFrom(url, '/quote'));
        const applicationToken = rawTokenFrom(
          opened.applicationLink!.url,
          '/supplier-application',
        );
        const storedRequest = await admin.procurementRequest.findUniqueOrThrow({
          where: { id: created.id },
        });
        expect(storedRequest.applicationTokenDigest).toBe(
          digestOpaqueToken('supplier-application', applicationToken),
        );
        expect(storedRequest.applicationExpiresAt!.getTime())
          .toBeLessThanOrEqual(storedRequest.quoteDeadline.getTime());
        expect(JSON.stringify(storedRequest)).not.toContain(applicationToken);
        const afterOpenDigests = await admin.supplierRequest.findMany({
          where: { requestId: created.id }, orderBy: { supplierId: 'asc' },
          select: { tokenDigest: true },
        });
        expect(afterOpenDigests).not.toEqual(beforeOpenDigests);
        expect(afterOpenDigests.map(({ tokenDigest }) => tokenDigest).sort()).toEqual(
          supplierTokens.map((token) => digestOpaqueToken('supplier-request', token)).sort(),
        );
        expect(JSON.stringify(afterOpenDigests)).not.toContain(supplierTokens[0]!);
        expect(opened.request).not.toHaveProperty('applicationTokenDigest');

        await expect(updateProcurementRequestDraft({
          actor, requestId: created.id, expectedVersion: 4,
          patch: { items: opened.request.items, sourcing: opened.request.sourcing },
        }, app, options)).rejects.toBeInstanceOf(ProcurementRequestConflictError);

        const shadowedDefault = await createProcurementRequestDraft({
          actor,
          draft: {
            title: 'All items override the default',
            menuId: 'menu-a',
            selectedItemIds: ['item1', 'item2'],
            defaultSourcing: currentAndVerified,
            sourcingOverrides: {
              item1: selectedNewOnly,
              item2: selectedNewOnly,
            },
            deliveryDetails,
            deliveryDate: '2099-01-03',
            quoteDeadline: '2099-01-02T10:00:00.000Z',
            commercialTerms: null,
          },
        }, app, options);
        expect(shadowedDefault.supplierRequests.map(({ supplierId }) => supplierId))
          .toEqual(['supplier-selected']);
        expect(await admin.supplierRequest.findMany({
          where: { requestId: shadowedDefault.id },
          select: { supplierId: true },
        })).toEqual([{ supplierId: 'supplier-selected' }]);
        const shadowedOpen = await openProcurementRequest({
          actor, requestId: shadowedDefault.id, expectedVersion: 1,
        }, app, options);
        expect(shadowedOpen.links.map(({ supplierId }) => supplierId))
          .toEqual(['supplier-selected']);
        expect(shadowedOpen).not.toHaveProperty('applicationLink');

        await admin.supplier.update({
          where: { id: 'supplier-selected' }, data: { isActive: false },
        });
        const historical = await getProcurementRequest({ actor, requestId: created.id }, app);
        expect(historical.supplierRequests).toEqual(expect.arrayContaining([
          expect.objectContaining({
            supplierId: 'supplier-selected',
            supplier: expect.objectContaining({ businessName: 'Selected New Foods', isActive: false }),
          }),
        ]));
        expect(await admin.auditEvent.findMany({
          where: {
            tenantId: 'tenant-a',
            entityId: {
              in: [created.id, ...created.supplierRequests.map(({ id }) => id)],
            },
          },
          orderBy: { action: 'asc' },
          select: { action: true, metadata: true },
        })).toEqual([
          { action: 'request.opened', metadata: { itemCount: 2, supplierCount: 2 } },
          { action: 'supplier-link.created', metadata: null },
          { action: 'supplier-link.created', metadata: null },
        ]);

        const reservedIdDocument = menuDocument();
        reservedIdDocument.dishes[0]!.ingredients = [{
          ...reservedIdDocument.dishes[0]!.ingredients[0]!,
          id: 'constructor',
        }];
        await admin.menu.create({
          data: {
            id: 'menu-reserved-id',
            tenantId: 'tenant-a',
            name: 'Reserved item ID menu',
            status: 'APPROVED',
            version: 1,
            document: reservedIdDocument,
            approvedAt: new Date('2098-12-30T10:00:00.000Z'),
            approvedByUserId: 'member-a',
            createdByUserId: 'member-a',
          },
        });
        const reservedIdRequest = await createProcurementRequestDraft({
          actor,
          draft: {
            title: 'Reserved item ID request',
            menuId: 'menu-reserved-id',
            selectedItemIds: ['constructor'],
            defaultSourcing: {
              v: 1,
              modes: ['VERIFIED_NEW'],
              currentSupplierIds: [],
              selectedNewSupplierIds: [],
              acceptVerifiedApplications: true,
            },
            sourcingOverrides: {},
            deliveryDetails,
            deliveryDate: '2099-01-03',
            quoteDeadline: '2099-01-02T10:00:00.000Z',
          },
        }, app, options);
        expect(reservedIdRequest.items.items[0]).toEqual(expect.objectContaining({
          id: 'constructor',
          sourcingOverride: null,
        }));
      } finally {
        await app?.$disconnect();
        await admin.$disconnect();
      }
    });
  });

  it('serializes same-version OPEN and rolls back forced token collisions', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let app: PrismaClient | undefined;
      try {
        await seedTenant(admin, {
          tenantId: 'tenant-race', userId: 'member-race', email: 'race@example.test',
        });
        await createApprovedMenu(admin, {
          tenantId: 'tenant-race', userId: 'member-race', menuId: 'menu-race',
        });
        const verifiedAt = new Date('2098-12-30T11:00:00.000Z');
        await admin.supplier.createMany({
          data: ['supplier-race-a', 'supplier-race-b'].map((id) => ({
            id,
            tenantId: 'tenant-race',
            businessName: id,
            relationshipType: 'CURRENT' as const,
            verificationStatus: 'VERIFIED' as const,
            verifiedAt,
            verifiedByUserId: 'member-race',
            capabilities: emptyCapabilities,
          })),
        });
        app = await provisionAppClient(admin, databaseUrl);
        const actor = { tenantId: 'tenant-race', userId: 'member-race' };
        const now = new Date('2098-12-31T09:00:00.000Z');
        const options = {
          now: () => now,
          transactionClock: async () => now,
          shareBaseUrl: 'https://app.quoteplate.example',
        };
        const createDraft = (title: string, supplierIds: string[]) =>
          createProcurementRequestDraft({
            actor,
            draft: {
              title, menuId: 'menu-race', selectedItemIds: ['item1'],
              defaultSourcing: {
                v: 1, modes: ['CURRENT'], currentSupplierIds: supplierIds,
                selectedNewSupplierIds: [], acceptVerifiedApplications: false,
              },
              sourcingOverrides: {}, deliveryDetails,
              deliveryDate: '2099-01-03', quoteDeadline: '2099-01-02T10:00:00.000Z',
            },
          }, app!, options);

        const raceDraft = await createDraft('Race request', ['supplier-race-a']);
        const opens = await Promise.allSettled([
          openProcurementRequest({ actor, requestId: raceDraft.id, expectedVersion: 1 }, app, options),
          openProcurementRequest({ actor, requestId: raceDraft.id, expectedVersion: 1 }, app, options),
        ]);
        expect(opens.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(opens.filter(({ status }) => status === 'rejected')).toHaveLength(1);
        expect(await admin.procurementRequest.findUniqueOrThrow({ where: { id: raceDraft.id } }))
          .toEqual(expect.objectContaining({ status: 'OPEN', version: 2 }));

        const collisionDraft = await createDraft(
          'Collision request',
          ['supplier-race-a', 'supplier-race-b'],
        );
        const before = await admin.supplierRequest.findMany({
          where: { requestId: collisionDraft.id }, orderBy: { id: 'asc' },
        });
        const raw = 'a'.repeat(43);
        const repeatedToken = {
          raw,
          digest: digestOpaqueToken('supplier-request', raw),
        };
        await expect(openProcurementRequest(
          { actor, requestId: collisionDraft.id, expectedVersion: 1 },
          app,
          { ...options, tokenFactory: () => repeatedToken },
        )).rejects.toBeDefined();
        expect(await admin.procurementRequest.findUniqueOrThrow({
          where: { id: collisionDraft.id },
        })).toEqual(expect.objectContaining({ status: 'DRAFT', version: 1, openedAt: null }));
        expect(await admin.supplierRequest.findMany({
          where: { requestId: collisionDraft.id }, orderBy: { id: 'asc' },
        })).toEqual(before);
        expect(await admin.auditEvent.count({
          where: { entityId: collisionDraft.id, action: 'request.opened' },
        })).toBe(0);
      } finally {
        await app?.$disconnect();
        await admin.$disconnect();
      }
    });
  });

  it('repeats an awarded request as an independent draft with only currently eligible suppliers', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let app: PrismaClient | undefined;
      try {
        await seedTenant(admin, {
          tenantId: 'tenant-repeat', userId: 'member-repeat', email: 'repeat@example.test',
        });
        await createApprovedMenu(admin, {
          tenantId: 'tenant-repeat', userId: 'member-repeat', menuId: 'menu-repeat',
        });
        const verifiedAt = new Date('2098-12-30T11:00:00.000Z');
        await admin.supplier.createMany({
          data: [
            {
              id: 'supplier-repeat-active', tenantId: 'tenant-repeat',
              businessName: 'Active Foods', relationshipType: 'CURRENT',
              verificationStatus: 'VERIFIED', verifiedAt,
              verifiedByUserId: 'member-repeat', isActive: true,
              capabilities: emptyCapabilities,
            },
            {
              id: 'supplier-repeat-inactive', tenantId: 'tenant-repeat',
              businessName: 'Inactive Foods', relationshipType: 'CURRENT',
              verificationStatus: 'VERIFIED', verifiedAt,
              verifiedByUserId: 'member-repeat', isActive: false,
              capabilities: emptyCapabilities,
            },
          ],
        });
        const sourceItems = {
          v: 1,
          items: [{
            id: 'item1', itemKey: 'butter', name: 'Butter', quantity: '4.25',
            unit: 'KILOGRAM', specification, sourcingOverride: null,
          }],
        };
        const sourceSourcing = {
          v: 1,
          default: {
            v: 1,
            modes: ['CURRENT', 'VERIFIED_NEW'],
            currentSupplierIds: ['supplier-repeat-active', 'supplier-repeat-inactive'],
            selectedNewSupplierIds: [],
            acceptVerifiedApplications: true,
          },
        };
        const source = await admin.procurementRequest.create({
          data: {
            id: 'request-repeat-source', tenantId: 'tenant-repeat',
            title: 'Last butter order', status: 'AWARDED', version: 7,
            menuId: 'menu-repeat', items: sourceItems, sourcing: sourceSourcing,
            deliveryDetails, deliveryDate: new Date('2098-12-29T00:00:00.000Z'),
            quoteDeadline: new Date('2098-12-28T10:00:00.000Z'),
            commercialTerms: 'Payment in 15 days.',
            applicationTokenDigest: 'a'.repeat(64),
            applicationExpiresAt: new Date('2098-12-28T10:00:00.000Z'),
            applicationRevokedAt: new Date('2098-12-28T11:00:00.000Z'),
            openedAt: new Date('2098-12-27T09:00:00.000Z'),
            awardedAt: new Date('2098-12-28T12:00:00.000Z'),
            createdByUserId: 'member-repeat',
          },
        });
        await admin.supplierRequest.createMany({
          data: [
            {
              tenantId: 'tenant-repeat', requestId: source.id,
              supplierId: 'supplier-repeat-active', tokenDigest: 'b'.repeat(64),
              expiresAt: new Date('2098-12-28T10:00:00.000Z'), quoteRevision: 1,
              quoteRevisions: { v: 1, revisions: [{ revision: 1 }] },
            },
            {
              tenantId: 'tenant-repeat', requestId: source.id,
              supplierId: 'supplier-repeat-inactive', tokenDigest: 'c'.repeat(64),
              expiresAt: new Date('2098-12-28T10:00:00.000Z'), quoteRevision: 0,
              quoteRevisions: emptyQuoteRevisions,
            },
          ],
        });
        app = await provisionAppClient(admin, databaseUrl);
        const now = new Date('2098-12-31T09:00:00.000Z');
        const repeated = await repeatProcurementRequest({
          actor: { tenantId: 'tenant-repeat', userId: 'member-repeat' },
          sourceRequestId: source.id,
          repeat: {
            expectedSourceVersion: 7,
            title: 'Butter order · next week',
            deliveryDate: '2099-01-03',
            quoteDeadline: '2099-01-02T10:00:00.000Z',
          },
        }, app, { now: () => now, transactionClock: async () => now });

        expect(repeated).toEqual(expect.objectContaining({
          status: 'DRAFT', version: 1, sourceRequestId: source.id,
          menuId: 'menu-repeat', title: 'Butter order · next week',
          items: sourceItems,
          sourcing: {
            v: 1,
            default: expect.objectContaining({
              currentSupplierIds: ['supplier-repeat-active'],
              acceptVerifiedApplications: true,
            }),
          },
          deliveryDetails,
          commercialTerms: 'Payment in 15 days.',
        }));
        expect(repeated).toEqual(expect.objectContaining({
          openedAt: null, awardedAt: null, cancelledAt: null,
        }));
        expect(repeated).not.toHaveProperty('applicationTokenDigest');
        expect(repeated.supplierRequests).toHaveLength(1);
        expect(repeated.supplierRequests[0]).toEqual(expect.objectContaining({
          supplierId: 'supplier-repeat-active', quoteRevision: 0, viewedAt: null,
          revokedAt: null,
        }));
        const storedGrant = await admin.supplierRequest.findFirstOrThrow({
          where: { requestId: repeated.id },
        });
        expect(storedGrant).toEqual(expect.objectContaining({
          supplierId: 'supplier-repeat-active', quoteRevision: 0,
          quoteRevisions: emptyQuoteRevisions,
        }));
        expect(storedGrant.tokenDigest).not.toBe('b'.repeat(64));
        const storedRepeat = await admin.procurementRequest.findUniqueOrThrow({
          where: { id: repeated.id },
        });
        expect(storedRepeat).toEqual(expect.objectContaining({
          status: 'DRAFT', version: 1, sourceRequestId: source.id,
          applicationTokenDigest: null, applicationExpiresAt: null,
          applicationRevokedAt: null, openedAt: null, awardedAt: null,
          cancelledAt: null,
        }));
        expect(await admin.award.count({ where: { requestId: repeated.id } })).toBe(0);
        expect(await admin.auditEvent.findMany({
          where: { entityId: repeated.id }, select: { action: true, metadata: true },
        })).toEqual([{
          action: 'request.repeated', metadata: { sourceRequestId: source.id },
        }]);

        await admin.procurementRequest.update({
          where: { id: source.id }, data: { items: { v: 1, items: [] } },
        });
        const storedSnapshot = await admin.procurementRequest.findUniqueOrThrow({
          where: { id: repeated.id }, select: { items: true, deliveryDetails: true },
        });
        expect(storedSnapshot).toEqual({ items: sourceItems, deliveryDetails });
      } finally {
        await app?.$disconnect();
        await admin.$disconnect();
      }
    });
  });
});
