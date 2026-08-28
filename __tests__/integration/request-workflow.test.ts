import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import {
  changeSupplierRequestLink,
  createProcurementRequestDraft,
  getProcurementRequest,
  listProcurementRequests,
  openProcurementRequest,
  ProcurementRequestConflictError,
  ProcurementRequestNotFoundError,
  updateProcurementRequestDraft,
} from '@/lib/procurement/request-service';
import { digestOpaqueToken } from '@/lib/security/tokens';

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
  input: { tenantId: string; userId: string; email: string },
) {
  return admin.tenant.create({
    data: {
      id: input.tenantId,
      name: `${input.tenantId} Kitchen`,
      addressLine: '12, 100 Feet Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin: '560038',
      phone: '9000000000',
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

const deliveryDetails = {
  addressLine: '12, 100 Feet Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560038',
  instructions: 'Deliver before 8:00 AM at the service entrance.',
};

function tokenFromFragmentShareUrl(value: string) {
  const url = new URL(value);
  expect(url.origin).toBe('https://app.quoteplate.example');
  expect(url.pathname).toBe('/quote');
  expect(url.search).toBe('');
  const raw = new URLSearchParams(url.hash.slice(1)).get('token');
  expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(`${url.origin}${url.pathname}`).not.toContain(raw!);
  return raw!;
}

describe('restricted PostgreSQL procurement request workflow', () => {
  jest.setTimeout(120_000);

  it('copies approved demand, issues tenant links atomically, and protects every transition', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let app: PrismaClient | undefined;

      try {
        await seedTenant(admin, {
          tenantId: 'tenant-a',
          userId: 'member-a',
          email: 'member-a@example.test',
        });
        await seedTenant(admin, {
          tenantId: 'tenant-b',
          userId: 'member-b',
          email: 'member-b@example.test',
        });

        const menu = await admin.menu.create({
          data: {
            id: 'menu-a',
            name: 'Reviewed weekly menu',
            status: 'APPROVED',
            version: 3,
            approvedAt: new Date(),
            tenant: { connect: { id: 'tenant-a' } },
            approvedBy: {
              connect: { tenantId_id: { tenantId: 'tenant-a', id: 'member-a' } },
            },
            createdBy: {
              connect: { tenantId_id: { tenantId: 'tenant-a', id: 'member-a' } },
            },
            recipes: {
              create: [
                {
                  id: 'recipe-a',
                  name: 'Dal makhani',
                  position: 0,
                  tenant: { connect: { id: 'tenant-a' } },
                  ingredients: {
                    create: [
                      {
                        id: 'ingredient-a',
                        name: 'Urad dal',
                        quantity: '12.500',
                        unit: 'KILOGRAM',
                        position: 0,
                        tenant: { connect: { id: 'tenant-a' } },
                      },
                      {
                        id: 'ingredient-b',
                        name: 'Butter',
                        quantity: '4.250',
                        unit: 'KILOGRAM',
                        position: 1,
                        tenant: { connect: { id: 'tenant-a' } },
                      },
                    ],
                  },
                },
              ],
            },
          },
        });
        await admin.menu.create({
          data: {
            id: 'menu-b',
            name: 'Other tenant menu',
            status: 'APPROVED',
            version: 1,
            approvedAt: new Date(),
            tenant: { connect: { id: 'tenant-b' } },
            approvedBy: {
              connect: { tenantId_id: { tenantId: 'tenant-b', id: 'member-b' } },
            },
            createdBy: {
              connect: { tenantId_id: { tenantId: 'tenant-b', id: 'member-b' } },
            },
            recipes: {
              create: {
                id: 'recipe-b',
                name: 'Private dish',
                position: 0,
                tenant: { connect: { id: 'tenant-b' } },
                ingredients: {
                  create: {
                    id: 'ingredient-private',
                    name: 'Private ingredient',
                    quantity: '1',
                    unit: 'KILOGRAM',
                    position: 0,
                    tenant: { connect: { id: 'tenant-b' } },
                  },
                },
              },
            },
          },
        });
        await admin.menu.create({
          data: {
            id: 'menu-draft-a',
            name: 'Unapproved menu',
            status: 'DRAFT',
            version: 1,
            tenant: { connect: { id: 'tenant-a' } },
            createdBy: {
              connect: { tenantId_id: { tenantId: 'tenant-a', id: 'member-a' } },
            },
            recipes: {
              create: {
                id: 'recipe-draft-a',
                name: 'Unreviewed dish',
                position: 0,
                tenant: { connect: { id: 'tenant-a' } },
                ingredients: {
                  create: {
                    id: 'ingredient-draft-a',
                    name: 'Unreviewed ingredient',
                    quantity: '1',
                    unit: 'KILOGRAM',
                    position: 0,
                    tenant: { connect: { id: 'tenant-a' } },
                  },
                },
              },
            },
          },
        });
        await admin.supplier.createMany({
          data: [
            {
              id: 'supplier-a',
              tenantId: 'tenant-a',
              businessName: 'Shakti Foods',
              phone: '919900000001',
            },
            {
              id: 'supplier-b',
              tenantId: 'tenant-a',
              businessName: 'GreenLeaf Enterprises',
              email: 'quotes@greenleaf.example',
            },
            {
              id: 'supplier-inactive',
              tenantId: 'tenant-a',
              businessName: 'Inactive Trader',
              isActive: false,
            },
            {
              id: 'supplier-private',
              tenantId: 'tenant-b',
              businessName: 'Private Supplier',
            },
          ],
        });
        await admin.user.create({
          data: {
            id: 'inactive-a',
            tenantId: 'tenant-a',
            name: 'Inactive Member',
            email: 'inactive-a@example.test',
            role: 'MEMBER',
            isActive: false,
          },
        });
        const privateRaw = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        const privateRequest = await admin.procurementRequest.create({
          data: {
            id: 'request-private-b',
            title: 'Tenant B private request',
            status: 'DRAFT',
            deliveryDetails,
            deliveryDate: new Date('2099-01-03T00:00:00.000Z'),
            quoteDeadline: new Date('2099-01-02T10:00:00.000Z'),
            tenant: { connect: { id: 'tenant-b' } },
            menu: {
              connect: { tenantId_id: { tenantId: 'tenant-b', id: 'menu-b' } },
            },
            createdBy: {
              connect: { tenantId_id: { tenantId: 'tenant-b', id: 'member-b' } },
            },
            items: {
              create: {
                name: 'Private ingredient',
                quantity: '1',
                unit: 'KILOGRAM',
                tenant: { connect: { id: 'tenant-b' } },
                sourceIngredient: {
                  connect: {
                    tenantId_id: {
                      tenantId: 'tenant-b',
                      id: 'ingredient-private',
                    },
                  },
                },
              },
            },
            supplierRequests: {
              create: {
                id: 'supplier-request-private-b',
                tokenDigest: digestOpaqueToken('supplier-request', privateRaw),
                expiresAt: new Date('2099-01-02T10:00:00.000Z'),
                tenant: { connect: { id: 'tenant-b' } },
                supplier: {
                  connect: {
                    tenantId_id: {
                      tenantId: 'tenant-b',
                      id: 'supplier-private',
                    },
                  },
                },
              },
            },
          },
        });

        app = await provisionAppClient(admin, databaseUrl);
        const actor = { tenantId: 'tenant-a', userId: 'member-a' };
        const now = new Date('2098-12-31T09:00:00.000Z');
        const options = {
          now: () => now,
          transactionClock: async () => now,
          shareBaseUrl: 'https://app.quoteplate.example',
        };
        const draftInput = {
          title: 'Weekly vegetables — Indiranagar',
          menuId: menu.id,
          ingredientSelection: {
            mode: 'SELECTED' as const,
            ingredientIds: ['ingredient-b'],
          },
          supplierIds: ['supplier-a', 'supplier-b'],
          deliveryDetails,
          deliveryDate: '2099-01-03',
          quoteDeadline: '2099-01-02T10:00:00.000Z',
          commercialTerms: 'Payment within 15 days after delivery.',
        };

        await expect(
          createProcurementRequestDraft(
            {
              actor,
              draft: {
                ...draftInput,
                menuId: 'menu-draft-a',
                ingredientSelection: { mode: 'ALL' },
              },
            },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestConflictError);
        await expect(
          listProcurementRequests(
            { actor: { tenantId: 'tenant-a', userId: 'inactive-a' } },
            app,
          ),
        ).rejects.toBeInstanceOf(AuthorizationError);

        const created = await createProcurementRequestDraft(
          { actor, draft: draftInput },
          app,
          options,
        );
        expect(created).toEqual(
          expect.objectContaining({
            tenantId: 'tenant-a',
            status: 'DRAFT',
            version: 1,
            menuId: 'menu-a',
          }),
        );
        expect(created.items).toEqual([
          expect.objectContaining({
            sourceIngredientId: 'ingredient-b',
            name: 'Butter',
            quantity: expect.objectContaining({}),
            unit: 'KILOGRAM',
          }),
        ]);
        expect(created.items[0]!.quantity.toString()).toBe('4.25');
        expect(created.supplierRequests).toHaveLength(2);
        expect(created.supplierRequests[0]).not.toHaveProperty('tokenDigest');
        expect(
          await admin.supplierRequest.findMany({
            where: { requestId: created.id },
            select: { tokenDigest: true },
          }),
        ).toEqual([
          { tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
          { tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
        ]);

        const tenantAList = await listProcurementRequests({ actor }, app);
        expect(tenantAList.requests.map(({ id }) => id)).not.toContain(
          privateRequest.id,
        );
        await expect(
          getProcurementRequest({ actor, requestId: privateRequest.id }, app),
        ).rejects.toBeInstanceOf(ProcurementRequestNotFoundError);
        await expect(
          updateProcurementRequestDraft(
            {
              actor,
              requestId: privateRequest.id,
              expectedVersion: 1,
              patch: { title: 'Attempted tenant A edit' },
            },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestNotFoundError);
        await expect(
          openProcurementRequest(
            { actor, requestId: privateRequest.id, expectedVersion: 1 },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestNotFoundError);
        await expect(
          changeSupplierRequestLink(
            {
              actor,
              requestId: privateRequest.id,
              supplierRequestId: 'supplier-request-private-b',
              expectedVersion: 1,
              action: 'rotate',
            },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestNotFoundError);

        const beforeFailedCreate = await admin.procurementRequest.count({
          where: { tenantId: 'tenant-a' },
        });
        await expect(
          createProcurementRequestDraft(
            {
              actor,
              draft: {
                ...draftInput,
                supplierIds: ['supplier-a', 'supplier-private'],
              },
            },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestNotFoundError);
        expect(
          await admin.procurementRequest.count({ where: { tenantId: 'tenant-a' } }),
        ).toBe(beforeFailedCreate);

        await expect(
          createProcurementRequestDraft(
            {
              actor,
              draft: { ...draftInput, menuId: 'menu-b' },
            },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestNotFoundError);
        await expect(
          updateProcurementRequestDraft(
            {
              actor,
              requestId: created.id,
              expectedVersion: 1,
              patch: { supplierIds: ['supplier-inactive'] },
            },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestConflictError);

        const updated = await updateProcurementRequestDraft(
          {
            actor,
            requestId: created.id,
            expectedVersion: 1,
            patch: {
              title: 'Weekly dairy and staples',
              supplierIds: ['supplier-b'],
              deliveryDetails,
              deliveryDate: '2099-01-04',
              quoteDeadline: '2099-01-03T09:00:00.000Z',
              commercialTerms: null,
            },
          },
          app,
          options,
        );
        expect(updated).toEqual(
          expect.objectContaining({
            title: 'Weekly dairy and staples',
            version: 2,
            commercialTerms: null,
          }),
        );
        expect(updated.supplierRequests).toHaveLength(1);
        expect(updated.supplierRequests[0]!.supplierId).toBe('supplier-b');

        await admin.ingredient.update({
          where: { id: 'ingredient-b' },
          data: { name: 'Salted butter corrected', quantity: '99.999' },
        });
        const immutable = await getProcurementRequest(
          { actor, requestId: created.id },
          app,
        );
        expect(immutable.items[0]).toEqual(
          expect.objectContaining({ name: 'Butter', unit: 'KILOGRAM' }),
        );
        expect(immutable.items[0]!.quantity.toString()).toBe('4.25');

        const opened = await openProcurementRequest(
          { actor, requestId: created.id, expectedVersion: 2 },
          app,
          options,
        );
        expect(opened.request).toEqual(
          expect.objectContaining({ status: 'OPEN', version: 3 }),
        );
        expect(opened.links).toHaveLength(1);
        expect(opened.links[0]).toEqual(
          expect.objectContaining({
            supplierId: 'supplier-b',
            url: expect.stringMatching(
              /^https:\/\/app\.quoteplate\.example\/quote#token=[A-Za-z0-9_-]{43}$/,
            ),
            expiresAt: '2099-01-03T09:00:00.000Z',
          }),
        );
        const rawToken = tokenFromFragmentShareUrl(opened.links[0]!.url);
        const storedGrant = await admin.supplierRequest.findUniqueOrThrow({
          where: { id: opened.links[0]!.supplierRequestId },
        });
        expect(storedGrant.tokenDigest).toBe(
          digestOpaqueToken('supplier-request', rawToken),
        );
        expect(JSON.stringify(storedGrant)).not.toContain(rawToken);
        expect(
          JSON.stringify(
            await admin.auditEvent.findMany({ where: { tenantId: 'tenant-a' } }),
          ),
        ).not.toContain(rawToken);
        await expect(
          openProcurementRequest(
            { actor, requestId: created.id, expectedVersion: 3 },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestConflictError);

        const rotated = await changeSupplierRequestLink(
          {
            actor,
            requestId: created.id,
            supplierRequestId: storedGrant.id,
            expectedVersion: 3,
            action: 'rotate',
          },
          app,
          options,
        );
        const rotatedRaw = tokenFromFragmentShareUrl(rotated.link!.url);
        expect(rotatedRaw).not.toBe(rawToken);
        expect(
          await admin.supplierRequest.count({
            where: { tokenDigest: digestOpaqueToken('supplier-request', rawToken) },
          }),
        ).toBe(0);
        expect(
          await admin.supplierRequest.count({
            where: { tokenDigest: digestOpaqueToken('supplier-request', rotatedRaw) },
          }),
        ).toBe(1);

        const concurrentRotations = await Promise.allSettled([
          changeSupplierRequestLink(
            {
              actor,
              requestId: created.id,
              supplierRequestId: storedGrant.id,
              expectedVersion: 4,
              action: 'rotate',
            },
            app,
            options,
          ),
          changeSupplierRequestLink(
            {
              actor,
              requestId: created.id,
              supplierRequestId: storedGrant.id,
              expectedVersion: 4,
              action: 'rotate',
            },
            app,
            options,
          ),
        ]);
        expect(concurrentRotations.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(concurrentRotations.filter(({ status }) => status === 'rejected')).toHaveLength(1);

        const afterRotate = await admin.procurementRequest.findUniqueOrThrow({
          where: { id: created.id },
        });
        const revoked = await changeSupplierRequestLink(
          {
            actor,
            requestId: created.id,
            supplierRequestId: storedGrant.id,
            expectedVersion: afterRotate.version,
            action: 'revoke',
          },
          app,
          options,
        );
        expect(revoked.link).toBeUndefined();
        expect(revoked.supplierRequest.revokedAt).toBeInstanceOf(Date);
        await expect(
          changeSupplierRequestLink(
            {
              actor,
              requestId: created.id,
              supplierRequestId: storedGrant.id,
              expectedVersion: revoked.request.version,
              action: 'revoke',
            },
            app,
            options,
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestConflictError);

        const pageOne = await listProcurementRequests(
          { actor, limit: 1 },
          app,
        );
        expect(pageOne.requests).toHaveLength(1);
        expect(pageOne.nextCursor).toBeNull();

        const auditEvents = await admin.auditEvent.findMany({
          where: { tenantId: 'tenant-a' },
          select: { action: true, metadata: true },
        });
        expect(auditEvents).toHaveLength(5);
        expect(auditEvents).toEqual(
          expect.arrayContaining([
            {
              action: 'request.opened',
              metadata: { itemCount: 1, supplierCount: 1 },
            },
            { action: 'supplier-link.revoked', metadata: null },
          ]),
        );
        expect(
          auditEvents.filter(({ action }) => action === 'supplier-link.created'),
        ).toHaveLength(3);
      } finally {
        await app?.$disconnect();
        await admin.$disconnect();
      }
    });
  });

  it('protects concurrent request transitions, collision rollback, coherent reads, and maximum issuance', async () => {
    await withMigratedPostgres(async (databaseUrl) => {
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let app: PrismaClient | undefined;
      try {
        await seedTenant(admin, {
          tenantId: 'tenant-race',
          userId: 'member-race',
          email: 'member-race@example.test',
        });
        await admin.menu.create({
          data: {
            id: 'menu-race',
            name: 'Race menu',
            status: 'APPROVED',
            version: 1,
            approvedAt: new Date(),
            tenant: { connect: { id: 'tenant-race' } },
            approvedBy: {
              connect: {
                tenantId_id: { tenantId: 'tenant-race', id: 'member-race' },
              },
            },
            createdBy: {
              connect: {
                tenantId_id: { tenantId: 'tenant-race', id: 'member-race' },
              },
            },
            recipes: {
              create: {
                id: 'recipe-race',
                name: 'Rice bowl',
                position: 0,
                tenant: { connect: { id: 'tenant-race' } },
                ingredients: {
                  create: {
                    id: 'ingredient-race',
                    name: 'Rice',
                    quantity: '25',
                    unit: 'KILOGRAM',
                    position: 0,
                    tenant: { connect: { id: 'tenant-race' } },
                  },
                },
              },
            },
          },
        });
        await admin.supplier.createMany({
          data: [
            {
              id: 'supplier-race-a',
              tenantId: 'tenant-race',
              businessName: 'Race A',
            },
            {
              id: 'supplier-race-b',
              tenantId: 'tenant-race',
              businessName: 'Race B',
            },
          ],
        });
        app = await provisionAppClient(admin, databaseUrl);
        const actor = { tenantId: 'tenant-race', userId: 'member-race' };
        const options = {
          now: () => new Date('2098-12-31T09:00:00.000Z'),
          transactionClock: async () =>
            new Date('2098-12-31T09:00:00.000Z'),
          shareBaseUrl: 'https://app.quoteplate.example',
        };
        const draft = await createProcurementRequestDraft(
          {
            actor,
            draft: {
              title: 'Race request',
              menuId: 'menu-race',
              ingredientSelection: { mode: 'ALL' },
              supplierIds: ['supplier-race-a'],
              deliveryDetails,
              deliveryDate: '2099-01-03',
              quoteDeadline: '2099-01-02T10:00:00.000Z',
            },
          },
          app,
          options,
        );
        const opens = await Promise.allSettled([
          openProcurementRequest(
            { actor, requestId: draft.id, expectedVersion: 1 },
            app,
            options,
          ),
          openProcurementRequest(
            { actor, requestId: draft.id, expectedVersion: 1 },
            app,
            options,
          ),
        ]);
        expect(opens.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(opens.filter(({ status }) => status === 'rejected')).toHaveLength(1);
        expect((await admin.procurementRequest.findUniqueOrThrow({ where: { id: draft.id } })).status)
          .toBe('OPEN');

        const collisionDraft = await createProcurementRequestDraft(
          {
            actor,
            draft: {
              title: 'Collision request',
              menuId: 'menu-race',
              ingredientSelection: { mode: 'ALL' },
              supplierIds: ['supplier-race-a', 'supplier-race-b'],
              deliveryDetails,
              deliveryDate: '2099-02-02',
              quoteDeadline: '2099-01-31T10:00:00.000Z',
            },
          },
          app,
          options,
        );
        await admin.supplierRequest.updateMany({
          where: { requestId: collisionDraft.id },
          data: { expiresAt: new Date('2099-01-31T10:00:00.000Z') },
        });
        const recappedDraft = await updateProcurementRequestDraft(
          {
            actor,
            requestId: collisionDraft.id,
            expectedVersion: 1,
            patch: { title: 'Collision request corrected' },
          },
          app,
          options,
        );
        expect(recappedDraft.version).toBe(2);
        const before = await admin.supplierRequest.findMany({
          where: { requestId: collisionDraft.id },
          orderBy: { id: 'asc' },
        });
        expect(before.map(({ expiresAt }) => expiresAt.toISOString())).toEqual([
          '2099-01-14T09:00:00.000Z',
          '2099-01-14T09:00:00.000Z',
        ]);
        const repeatedToken = {
          raw: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          digest: digestOpaqueToken(
            'supplier-request',
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ),
        };
        await expect(
          openProcurementRequest(
            { actor, requestId: collisionDraft.id, expectedVersion: 2 },
            app,
            { ...options, tokenFactory: () => repeatedToken },
          ),
        ).rejects.toBeDefined();
        expect(
          await admin.procurementRequest.findUniqueOrThrow({
            where: { id: collisionDraft.id },
          }),
        ).toEqual(expect.objectContaining({ status: 'DRAFT', version: 2, openedAt: null }));
        expect(
          await admin.supplierRequest.findMany({
            where: { requestId: collisionDraft.id },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(before);
        expect(
          await admin.auditEvent.count({
            where: { entityId: collisionDraft.id, action: 'request.opened' },
          }),
        ).toBe(0);

        let coherentMutationReady!: () => void;
        const coherentMutationStarted = new Promise<void>((resolve) => {
          coherentMutationReady = resolve;
        });
        let releaseCoherentMutation!: () => void;
        const coherentMutationRelease = new Promise<void>((resolve) => {
          releaseCoherentMutation = resolve;
        });
        const coherentExpiresAt = new Date('2099-01-30T10:00:00.000Z');
        const coherentMutation = app.$transaction(
          async (transaction) => {
            await transaction.$queryRaw`
              SELECT set_config('app.tenant_id', ${actor.tenantId}, true)
            `;
            await transaction.$queryRaw`
              SELECT "id"
              FROM "ProcurementRequest"
              WHERE "tenantId" = ${actor.tenantId}
                AND "id" = ${collisionDraft.id}
              FOR UPDATE
            `;
            await transaction.procurementRequest.update({
              where: {
                tenantId_id: {
                  tenantId: actor.tenantId,
                  id: collisionDraft.id,
                },
              },
              data: {
                title: 'Coherent request view',
                version: { increment: 1 },
              },
            });
            await transaction.supplierRequest.updateMany({
              where: { tenantId: actor.tenantId, requestId: collisionDraft.id },
              data: { expiresAt: coherentExpiresAt },
            });
            coherentMutationReady();
            await coherentMutationRelease;
          },
          { timeout: 10_000 },
        );
        await coherentMutationStarted;

        const concurrentRead = getProcurementRequest(
          { actor, requestId: collisionDraft.id },
          app,
        );
        const readBeforeCommit = await Promise.race([
          concurrentRead.then(() => 'resolved' as const),
          new Promise<'pending'>((resolve) => {
            setTimeout(() => resolve('pending'), 500);
          }),
        ]);
        releaseCoherentMutation();
        await coherentMutation;

        expect(readBeforeCommit).toBe('pending');
        await expect(concurrentRead).resolves.toEqual(
          expect.objectContaining({
            title: 'Coherent request view',
            version: 3,
            supplierRequests: expect.arrayContaining([
              expect.objectContaining({ expiresAt: coherentExpiresAt }),
            ]),
          }),
        );

        const deadlineDraft = await createProcurementRequestDraft(
          {
            actor,
            draft: {
              title: 'Deadline lock request',
              menuId: 'menu-race',
              ingredientSelection: { mode: 'ALL' },
              supplierIds: ['supplier-race-a'],
              deliveryDetails,
              deliveryDate: '2099-03-03',
              quoteDeadline: '2099-03-02T10:00:00.000Z',
            },
          },
          app,
        );
        let deadlineLockReady!: () => void;
        const deadlineLockStarted = new Promise<void>((resolve) => {
          deadlineLockReady = resolve;
        });
        let releaseDeadlineLock!: () => void;
        const deadlineLockRelease = new Promise<void>((resolve) => {
          releaseDeadlineLock = resolve;
        });
        const deadlineBlocker = app.$transaction(
          async (transaction) => {
            await transaction.$queryRaw`
              SELECT set_config('app.tenant_id', ${actor.tenantId}, true)
            `;
            await transaction.$queryRaw`
              SELECT "id"
              FROM "ProcurementRequest"
              WHERE "tenantId" = ${actor.tenantId}
                AND "id" = ${deadlineDraft.id}
              FOR UPDATE
            `;
            await transaction.$executeRaw`
              UPDATE "ProcurementRequest"
              SET "quoteDeadline" =
                (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1500 milliseconds'
              WHERE "tenantId" = ${actor.tenantId}
                AND "id" = ${deadlineDraft.id}
            `;
            deadlineLockReady();
            await deadlineLockRelease;
          },
          { timeout: 10_000 },
        );
        await deadlineLockStarted;

        const blockedOpen = expect(
          openProcurementRequest(
            { actor, requestId: deadlineDraft.id, expectedVersion: 1 },
            app,
            { shareBaseUrl: 'https://app.quoteplate.example' },
          ),
        ).rejects.toBeInstanceOf(ProcurementRequestConflictError);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        releaseDeadlineLock();
        await deadlineBlocker;
        await blockedOpen;
        expect(
          await admin.procurementRequest.findUniqueOrThrow({
            where: { id: deadlineDraft.id },
          }),
        ).toEqual(expect.objectContaining({ status: 'DRAFT', version: 1, openedAt: null }));

        const batchSupplierIds = [
          'supplier-race-a',
          'supplier-race-b',
          ...Array.from({ length: 98 }, (_, index) => `supplier-batch-${index}`),
        ];
        await admin.supplier.createMany({
          data: batchSupplierIds.slice(2).map((id, index) => ({
            id,
            tenantId: actor.tenantId,
            businessName: `Batch supplier ${index}`,
          })),
        });
        app.$use(async (params, next) => {
          if (
            (params.model === 'SupplierRequest' && params.action === 'update') ||
            (params.model === 'AuditEvent' && params.action === 'create')
          ) {
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          return next(params);
        });
        const maximumDraft = await createProcurementRequestDraft(
          {
            actor,
            draft: {
              title: 'Maximum supplier request',
              menuId: 'menu-race',
              ingredientSelection: { mode: 'ALL' },
              supplierIds: batchSupplierIds,
              deliveryDetails,
              deliveryDate: '2099-04-03',
              quoteDeadline: '2099-04-02T10:00:00.000Z',
            },
          },
          app,
          options,
        );
        const maximumOpened = await openProcurementRequest(
          { actor, requestId: maximumDraft.id, expectedVersion: 1 },
          app,
          options,
        );
        expect(maximumOpened.links).toHaveLength(100);
        const maximumRawTokens = maximumOpened.links.map(({ url }) =>
          tokenFromFragmentShareUrl(url),
        );
        expect(new Set(maximumRawTokens).size).toBe(100);
        expect(
          await admin.auditEvent.count({
            where: {
              tenantId: actor.tenantId,
              action: 'supplier-link.created',
              entityId: {
                in: maximumOpened.links.map(({ supplierRequestId }) => supplierRequestId),
              },
            },
          }),
        ).toBe(100);
      } finally {
        await app?.$disconnect();
        await admin.$disconnect();
      }
    });
  });
});
