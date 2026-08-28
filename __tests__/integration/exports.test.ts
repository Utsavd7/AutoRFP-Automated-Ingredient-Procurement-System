import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

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

test('exports stay tenant-scoped, use immutable award snapshots, and persist only bounded audits', async () => {
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
      const itemId = 'item-export-a';
      const grantId = 'grant-export-a';
      const quoteId = 'quote-export-a';
      const quoteItemId = 'quote-item-export-a';
      const awardId = 'award-export-a';
      const qrRequestId = 'request-export-qr';
      const token = 'R'.repeat(43);
      await admin.supplier.create({
        data: {
          id: supplierId,
          tenantId,
          businessName: 'Live supplier name',
          contactName: 'Live contact',
          gstin: '27ABCDE9999F1Z1',
        },
      });
      await admin.procurementRequest.create({
        data: {
          id: requestId,
          tenantId,
          title: 'Fresh produce week 36',
          status: 'AWARDED',
          version: 3,
          deliveryDetails: {
            addressLine: 'Service gate, 18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001',
          },
          deliveryDate: new Date('2099-09-05T00:00:00.000Z'),
          quoteDeadline: new Date('2099-09-03T10:00:00.000Z'),
          commercialTerms: 'Payment in 15 days.',
          openedAt: new Date('2099-08-28T08:00:00.000Z'),
          awardedAt: new Date('2099-08-28T10:00:00.000Z'),
          createdByUserId: userId,
        },
      });
      await admin.requestItem.create({
        data: {
          id: itemId, tenantId, requestId, name: 'Tomato', quantity: '100', unit: 'KILOGRAM',
        },
      });
      await admin.supplierRequest.create({
        data: {
          id: grantId, tenantId, requestId, supplierId,
          tokenDigest: digestOpaqueToken('supplier-request', 'S'.repeat(43)),
          expiresAt: new Date('2099-09-03T10:00:00.000Z'),
        },
      });
      await admin.supplierQuote.create({
        data: {
          id: quoteId, tenantId, supplierRequestId: grantId, revision: 1,
          subtotalPaise: BigInt(7_968_000), gstPaise: BigInt(398_400),
          freightPaise: BigInt(50_000), totalPaise: BigInt(8_416_400),
          deliveryDate: new Date('2099-09-05T00:00:00.000Z'),
          validUntil: new Date('2099-09-04T00:00:00.000Z'),
          commercialTerms: 'Payment in 15 days.',
        },
      });
      await admin.supplierQuoteItem.create({
        data: {
          id: quoteItemId, tenantId, quoteId, requestItemId: itemId, noQuote: false,
          availableQuantity: '100', unit: 'KILOGRAM', unitRatePaise: BigInt(79_680),
          gstBasisPoints: 500, subtotalPaise: BigInt(7_968_000),
          gstPaise: BigInt(398_400), totalPaise: BigInt(8_366_400),
        },
      });
      await admin.award.create({
        data: {
          id: awardId, tenantId, requestId, rationale: 'Best landed cost.',
          awardedByUserId: userId, totalPaise: BigInt(8_416_400),
          supplierSnapshots: [{
            supplierId, supplierName: 'Committed Snapshot Foods', contactName: 'Snapshot contact',
            phone: '9111111111', whatsappNumber: null, email: 'snapshot@example.test',
            addressLine: '7 APMC Yard', city: 'Navi Mumbai', state: 'Maharashtra', pin: '400705',
            gstin: '27ABCDE9999F1Z1', quoteId, supplierRequestId: grantId, revision: 1,
            freightPaise: '50000', deliveryDate: '2099-09-05', validUntil: '2099-09-04',
            commercialTerms: 'Payment in 15 days.', notes: null,
            submittedAt: '2099-08-28T09:00:00.000Z',
          }],
          deliverySnapshot: {
            requestTitle: 'Fresh produce week 36', requestedDeliveryDate: '2099-09-05',
            deliveryDetails: {
              addressLine: 'Service gate, 18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001',
            },
            buyer: {
              name: 'tenant-export-a Restaurant', gstin: '27ABCDE1234F1Z5', addressLine: '18 Market Road',
              city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000',
            },
          },
        },
      });
      await admin.awardLine.create({
        data: {
          tenantId, awardId, requestItemId: itemId, supplierQuoteItemId: quoteItemId, supplierId,
          quantity: '100', unit: 'KILOGRAM', unitRatePaise: BigInt(79_680),
          gstBasisPoints: 500, subtotalPaise: BigInt(7_968_000),
          gstPaise: BigInt(398_400), totalPaise: BigInt(8_366_400),
        },
      });
      await admin.procurementRequest.create({
        data: {
          id: qrRequestId,
          tenantId,
          title: 'Supplier link request',
          status: 'OPEN',
          version: 2,
          deliveryDetails: {
            addressLine: 'Service gate, 18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001',
          },
          deliveryDate: new Date('2099-10-05T00:00:00.000Z'),
          quoteDeadline: new Date('2099-10-03T10:00:00.000Z'),
          openedAt: new Date('2099-09-28T08:00:00.000Z'),
          createdByUserId: userId,
        },
      });
      await admin.supplierRequest.create({
        data: {
          id: 'grant-export-qr', tenantId, requestId: qrRequestId, supplierId,
          tokenDigest: digestOpaqueToken('supplier-request', token),
          expiresAt: new Date('2099-10-03T10:00:00.000Z'),
        },
      });

      const renderedPurchaseOrders: unknown[] = [];
      const service = createExportOperations({
        transact: (scope, callback) => withTenant(scope, callback, app),
        renderQr: async () => new Uint8Array(Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1')),
        renderPdf: async (data) => {
          renderedPurchaseOrders.push(data);
          return new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1_500)]));
        },
      });

      const actor = { tenantId, userId };
      const requestExport = await service.requestCsv({ actor, requestId, kind: 'request' });
      expect(Buffer.from(requestExport.bytes).toString()).toContain('Fresh produce week 36');
      await expect(service.requestCsv({
        actor: { tenantId: 'tenant-export-b', userId: 'tenant-export-b-member' },
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

      const originalPurchaseOrder = await service.purchaseOrder({ actor, awardId, supplierId });
      await admin.supplier.update({
        where: { tenantId_id: { tenantId, id: supplierId } },
        data: { businessName: 'Edited live supplier', contactName: 'Edited contact' },
      });
      await admin.tenant.update({
        where: { id: tenantId },
        data: {
          name: 'Edited live restaurant', gstin: null, addressLine: '99 Changed Road',
          city: 'Pune', state: 'Maharashtra', pin: '411001', phone: '9888888888',
        },
      });
      await admin.procurementRequest.update({
        where: { tenantId_id: { tenantId, id: requestId } },
        data: { title: 'Edited live request title' },
      });
      const regeneratedPurchaseOrder = await service.purchaseOrder({ actor, awardId, supplierId });
      expect(regeneratedPurchaseOrder.filename).toBe(originalPurchaseOrder.filename);
      expect(regeneratedPurchaseOrder.filename).toBe(
        'fresh-produce-week-36-po-committed-snapshot-foods.pdf',
      );
      expect(renderedPurchaseOrders).toHaveLength(2);
      expect(renderedPurchaseOrders[0]).toEqual(renderedPurchaseOrders[1]);
      expect(renderedPurchaseOrders[1]).toEqual(expect.objectContaining({
        supplier: expect.objectContaining({
          supplierName: 'Committed Snapshot Foods', contactName: 'Snapshot contact',
        }),
        buyer: expect.objectContaining({
          name: 'tenant-export-a Restaurant', addressLine: '18 Market Road',
        }),
        requestTitle: 'Fresh produce week 36',
      }));

      const audits = await admin.auditEvent.findMany({
        where: { tenantId, action: 'audit.export' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits).toHaveLength(4);
      expect(JSON.stringify(audits)).not.toContain(token);
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
