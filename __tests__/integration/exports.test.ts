import { randomBytes } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { withTenant } from '@/lib/db/tenant-transaction';
import {
  createExportOperations,
  ExportNotFoundError,
} from '@/lib/exports/export-service';
import { digestOpaqueToken } from '@/lib/security/tokens';

import { withMigratedPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

const specification = {
  v: 1,
  category: 'VEGETABLES',
  description: 'Firm red tomato',
  preferredBrand: 'Farm Select',
  packSize: '5 kg crate',
  qualityGrade: 'A',
  notes: null,
  referenceUrl: null,
  thumbnailWebpBase64: null,
} as const;

function requestDocuments(supplierId: string, itemName = '=Tomato') {
  return {
    items: {
      v: 1,
      items: [{
        id: 'tomato',
        itemKey: 'tomato',
        name: itemName,
        quantity: '100',
        unit: 'KILOGRAM',
        specification,
        sourcingOverride: null,
      }],
    },
    sourcing: {
      v: 1,
      default: {
        v: 1,
        modes: ['CURRENT'],
        currentSupplierIds: [supplierId],
        selectedNewSupplierIds: [],
        acceptVerifiedApplications: false,
      },
    },
  };
}

function quoteRevisions(input: {
  supplierBrand: string;
  revision: number;
  submittedAt: string;
}) {
  return {
    v: 1,
    revisions: [{
      revision: input.revision,
      submittedAt: input.submittedAt,
      deliveryDate: '2099-09-05',
      validUntil: '2099-09-04',
      minimumOrder: 'Minimum invoice INR 2,500',
      freightPaise: '50000',
      commercialTerms: 'Payment in 15 days.',
      notes: null,
      items: [{
        requestItemId: 'tomato',
        noQuote: false,
        availableQuantity: '100',
        unit: 'KILOGRAM',
        unitRatePaise: '79680',
        gstBasisPoints: 500,
        taxInclusive: false,
        suppliedBrand: input.supplierBrand,
        suppliedPackSize: '10 kg crate',
        suppliedQualityGrade: 'Premium',
        substitution: 'Roma tomato',
        subtotalPaise: '7968000',
        gstPaise: '398400',
        totalPaise: '8366400',
      }],
      subtotalPaise: '7968000',
      gstPaise: '398400',
      totalPaise: '8416400',
    }],
  };
}

function awardDocuments(input: {
  supplierId: string;
  supplierRequestId: string;
}) {
  return {
    allocationLines: {
      v: 1,
      lines: [{
        requestItemId: 'tomato',
        supplierRequestId: input.supplierRequestId,
        supplierId: input.supplierId,
        quoteRevision: 1,
        quantity: '100',
        unit: 'KILOGRAM',
        unitRatePaise: '79680',
        gstBasisPoints: 500,
        subtotalPaise: '7968000',
        gstPaise: '398400',
        totalPaise: '8366400',
      }],
    },
    supplierSnapshots: {
      v: 1,
      suppliers: [{
        supplierId: input.supplierId,
        supplierRequestId: input.supplierRequestId,
        quoteRevision: 1,
        supplierName: '+Committed Snapshot Foods',
        contactName: 'Snapshot contact',
        phone: '9111111111',
        whatsappNumber: null,
        email: 'snapshot@example.test',
        addressLine: '7 APMC Yard',
        city: 'Navi Mumbai',
        state: 'Maharashtra',
        pin: '400705',
        gstin: '27ABCDE9999F1Z1',
        submittedAt: '2026-08-28T09:00:00.000Z',
        deliveryDate: '2099-09-05',
        validUntil: '2099-09-04',
        minimumOrder: 'Minimum invoice INR 2,500',
        freightPaise: '50000',
        commercialTerms: 'Payment in 15 days.',
        notes: 'Use ventilated crates.',
        subtotalPaise: '7968000',
        gstPaise: '398400',
        totalPaise: '8416400',
        lines: [{
          requestItemId: 'tomato',
          itemKey: 'tomato',
          itemName: '=Tomato',
          requestedQuantity: '100',
          requestedUnit: 'KILOGRAM',
          requestedSpecification: specification,
          taxInclusive: false,
          suppliedBrand: 'Snapshot Market Fresh',
          suppliedPackSize: '10 kg crate',
          suppliedQualityGrade: 'Premium',
          substitution: 'Roma tomato',
        }],
      }],
    },
    deliverySnapshot: {
      v: 1,
      requestTitle: 'Fresh produce week 36',
      requestedDeliveryDate: '2099-09-05',
      deliveryDetails: {
        addressLine: 'Service gate, 18 Market Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400001',
        instructions: 'Deliver before 8:00 AM.',
      },
      commercialTerms: 'Rates must include packing.',
      buyer: {
        name: 'tenant-export-a Restaurant',
        gstin: '27ABCDE1234F1Z5',
        addressLine: '18 Market Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400001',
        phone: '9000000000',
      },
    },
  };
}

test('exports stay tenant-scoped, preserve compact awards, and audit only output metadata', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = randomBytes(24).toString('hex');
    await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
    const app = new PrismaClient({
      datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
    });
    await app.$connect();

    try {
      for (const tenantId of ['tenant-export-a', 'tenant-export-b']) {
        await admin.tenant.create({
          data: {
            id: tenantId,
            name: `${tenantId} Restaurant`,
            addressLine: '18 Market Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            pin: '400001',
            phone: '9000000000',
            gstin: '27ABCDE1234F1Z5',
            users: {
              create: {
                id: `${tenantId}-member`,
                name: 'Procurement member',
                email: `${tenantId}@example.test`,
                role: 'MEMBER',
              },
            },
          },
        });
      }

      const tenantId = 'tenant-export-a';
      const userId = `${tenantId}-member`;
      const supplierId = 'supplier-export-a';
      const requestId = 'request-export-a';
      const supplierRequestId = 'supplier-request-export-a';
      const awardId = 'award-export-a';
      const qrRequestId = 'request-export-qr';
      const token = 'R'.repeat(43);
      const request = requestDocuments(supplierId);
      const committed = awardDocuments({ supplierId, supplierRequestId });

      await admin.supplier.create({
        data: {
          id: supplierId,
          tenantId,
          businessName: '@Live supplier name',
          contactName: 'Live contact',
          gstin: '27ABCDE9999F1Z1',
          capabilities: { v: 1, categories: [], items: [] },
        },
      });
      await admin.procurementRequest.create({
        data: {
          id: requestId,
          tenantId,
          title: 'Fresh produce week 36',
          status: 'AWARDED',
          version: 3,
          items: request.items as unknown as Prisma.InputJsonValue,
          sourcing: request.sourcing as unknown as Prisma.InputJsonValue,
          deliveryDetails: {
            addressLine: 'Service gate, 18 Market Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            pin: '400001',
            instructions: 'Deliver before 8:00 AM.',
          },
          deliveryDate: new Date('2099-09-05T00:00:00.000Z'),
          quoteDeadline: new Date('2099-09-03T10:00:00.000Z'),
          commercialTerms: 'Payment in 15 days.',
          openedAt: new Date('2026-08-28T08:00:00.000Z'),
          awardedAt: new Date('2026-08-28T10:00:00.000Z'),
          createdByUserId: userId,
        },
      });
      await admin.supplierRequest.create({
        data: {
          id: supplierRequestId,
          tenantId,
          requestId,
          supplierId,
          tokenDigest: digestOpaqueToken('supplier-request', 'S'.repeat(43)),
          expiresAt: new Date('2099-09-03T10:00:00.000Z'),
          revokedAt: new Date('2026-08-28T10:00:00.000Z'),
          quoteRevision: 1,
          quoteRevisions: quoteRevisions({
            supplierBrand: 'Live Market Fresh',
            revision: 1,
            submittedAt: '2026-08-28T09:00:00.000Z',
          }) as unknown as Prisma.InputJsonValue,
        },
      });
      await admin.award.create({
        data: {
          id: awardId,
          tenantId,
          requestId,
          rationale: 'Internal decision rationale.',
          allocationLines: committed.allocationLines as unknown as Prisma.InputJsonValue,
          supplierSnapshots: committed.supplierSnapshots as unknown as Prisma.InputJsonValue,
          deliverySnapshot: committed.deliverySnapshot as unknown as Prisma.InputJsonValue,
          totalPaise: BigInt(8_416_400),
          awardedByUserId: userId,
          createdAt: new Date('2026-08-28T10:00:00.000Z'),
        },
      });

      const qrRequest = requestDocuments(supplierId, 'Coriander');
      await admin.procurementRequest.create({
        data: {
          id: qrRequestId,
          tenantId,
          title: 'Supplier link request',
          status: 'OPEN',
          version: 2,
          items: qrRequest.items as unknown as Prisma.InputJsonValue,
          sourcing: qrRequest.sourcing as unknown as Prisma.InputJsonValue,
          deliveryDetails: {
            addressLine: '18 Market Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            pin: '400001',
          },
          deliveryDate: new Date('2099-10-05T00:00:00.000Z'),
          quoteDeadline: new Date('2099-10-03T10:00:00.000Z'),
          openedAt: new Date('2026-09-28T08:00:00.000Z'),
          createdByUserId: userId,
        },
      });
      await admin.supplierRequest.create({
        data: {
          id: 'supplier-request-export-qr',
          tenantId,
          requestId: qrRequestId,
          supplierId,
          tokenDigest: digestOpaqueToken('supplier-request', token),
          expiresAt: new Date('2099-10-03T10:00:00.000Z'),
          quoteRevisions: { v: 1, revisions: [] },
        },
      });

      const renderedPurchaseOrders: unknown[] = [];
      const service = createExportOperations({
        transact: (scope, callback) => withTenant(scope, callback, app),
        renderQr: async () => new Uint8Array(
          Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1'),
        ),
        renderPdf: async (data) => {
          renderedPurchaseOrders.push(structuredClone(data));
          return new Uint8Array(Buffer.concat([
            Buffer.from('%PDF-1.7\n'),
            Buffer.alloc(1_500),
          ]));
        },
      });

      const actor = { tenantId, userId };
      const initialRequest = await service.requestCsv({
        actor,
        requestId,
        kind: 'request',
      });
      const initialQuotes = await service.requestCsv({
        actor,
        requestId,
        kind: 'quotes',
      });
      const initialAward = await service.requestCsv({
        actor,
        requestId,
        kind: 'award',
      });
      const initialAccounting = await service.requestCsv({
        actor,
        requestId,
        kind: 'accounting',
      });
      const initialPurchaseOrder = await service.purchaseOrder({
        actor,
        awardId,
        supplierId,
      });

      expect(Buffer.from(initialRequest.bytes).toString()).toContain("'=Tomato");
      expect(Buffer.from(initialQuotes.bytes).toString()).toContain(
        "'@Live supplier name",
      );
      expect(Buffer.from(initialAward.bytes).toString()).toContain(
        "'+Committed Snapshot Foods",
      );
      expect(Buffer.from(initialAccounting.bytes).toString()).toContain(
        '84164.00',
      );
      expect(Buffer.from(initialPurchaseOrder.bytes).subarray(0, 5).toString())
        .toBe('%PDF-');

      await expect(service.requestCsv({
        actor: {
          tenantId: 'tenant-export-b',
          userId: 'tenant-export-b-member',
        },
        requestId,
        kind: 'request',
      })).rejects.toBeInstanceOf(ExportNotFoundError);

      const qr = await service.qr({
        actor,
        requestId: qrRequestId,
        expectedOrigin: 'https://quoteplate.example',
        url: `https://quoteplate.example/quote#token=${token}`,
      });
      expect(Buffer.from(qr.bytes).subarray(0, 8)).toEqual(
        Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1'),
      );

      const editedRequest = requestDocuments(supplierId, 'Edited live tomato');
      await admin.tenant.update({
        where: { id: tenantId },
        data: {
          name: 'Edited live restaurant',
          gstin: null,
          addressLine: '99 Changed Road',
          city: 'Pune',
          pin: '411001',
          phone: '9888888888',
        },
      });
      await admin.supplier.update({
        where: { tenantId_id: { tenantId, id: supplierId } },
        data: {
          businessName: 'Edited live supplier',
          contactName: 'Edited contact',
        },
      });
      await admin.procurementRequest.update({
        where: { tenantId_id: { tenantId, id: requestId } },
        data: {
          title: 'Edited live request title',
          items: editedRequest.items as unknown as Prisma.InputJsonValue,
        },
      });
      await admin.supplierRequest.update({
        where: { tenantId_id: { tenantId, id: supplierRequestId } },
        data: {
          quoteRevisions: quoteRevisions({
            supplierBrand: 'Edited live brand',
            revision: 1,
            submittedAt: '2026-08-29T09:00:00.000Z',
          }) as unknown as Prisma.InputJsonValue,
        },
      });

      const editedCurrentRequest = await service.requestCsv({
        actor,
        requestId,
        kind: 'request',
      });
      const editedCurrentQuotes = await service.requestCsv({
        actor,
        requestId,
        kind: 'quotes',
      });
      const regeneratedAward = await service.requestCsv({
        actor,
        requestId,
        kind: 'award',
      });
      const regeneratedAccounting = await service.requestCsv({
        actor,
        requestId,
        kind: 'accounting',
      });
      const regeneratedPurchaseOrder = await service.purchaseOrder({
        actor,
        awardId,
        supplierId,
      });

      expect(Buffer.from(editedCurrentRequest.bytes).toString()).toContain(
        'Edited live request title',
      );
      expect(Buffer.from(editedCurrentQuotes.bytes).toString()).toContain(
        'Edited live brand',
      );
      expect(regeneratedAward.bytes).toEqual(initialAward.bytes);
      expect(regeneratedAccounting.bytes).toEqual(initialAccounting.bytes);
      expect(regeneratedPurchaseOrder.bytes).toEqual(initialPurchaseOrder.bytes);
      expect(regeneratedPurchaseOrder.filename).toBe(
        'fresh-produce-week-36-po-committed-snapshot-foods.pdf',
      );
      expect(renderedPurchaseOrders).toHaveLength(2);
      expect(renderedPurchaseOrders[0]).toEqual(renderedPurchaseOrders[1]);
      expect(renderedPurchaseOrders[1]).toEqual(expect.objectContaining({
        requestTitle: 'Fresh produce week 36',
        buyer: expect.objectContaining({
          name: 'tenant-export-a Restaurant',
          addressLine: '18 Market Road',
        }),
        supplier: expect.objectContaining({
          supplierName: '+Committed Snapshot Foods',
          contactName: 'Snapshot contact',
        }),
        lines: [expect.objectContaining({
          requestedBrand: 'Farm Select',
          suppliedBrand: 'Snapshot Market Fresh',
        })],
      }));
      expect(JSON.stringify(renderedPurchaseOrders)).not.toContain(
        'Internal decision rationale.',
      );

      const audits = await admin.auditEvent.findMany({
        where: { tenantId, action: 'audit.export' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits).toHaveLength(11);
      for (const audit of audits) {
        expect(Object.keys(audit.metadata as object).sort()).toEqual([
          'byteCount',
          'format',
          'kind',
        ]);
      }
      const serializedAudits = JSON.stringify(audits);
      expect(serializedAudits).not.toContain(token);
      expect(serializedAudits).not.toContain('Internal decision rationale.');
      expect(serializedAudits).not.toContain('Snapshot Market Fresh');

      const fileTables = await admin.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename ~* '(generated|export|file|blob)'
      `;
      expect(fileTables).toEqual([]);
    } finally {
      await app.$disconnect();
      await admin.$disconnect();
    }
  });
});
