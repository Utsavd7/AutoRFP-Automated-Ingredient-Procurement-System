import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  createPrismaPublicSupplierGrantRepository,
  exchangeSupplierGrantToken,
} from '@/lib/security/public-grant';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import { digestOpaqueToken } from '@/lib/security/tokens';

import { withMigratedPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

test('restricted runtime resolves only live public supplier grants', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = randomBytes(24).toString('hex');
    let app: PrismaClient | undefined;
    const rawToken = 'A'.repeat(43);
    const now = new Date('2026-08-28T10:00:00.000Z');

    try {
      await admin.tenant.create({
        data: {
          id: 'public-grant-tenant',
          name: 'Grant Kitchen',
          addressLine: '1 Market Road',
          city: 'Pune',
          state: 'Maharashtra',
          pin: '411001',
          phone: '9000000000',
          users: {
            create: {
              id: 'public-grant-owner',
              name: 'Owner',
              email: 'grant-owner@example.test',
              role: 'OWNER',
            },
          },
          suppliers: {
            create: {
              id: 'public-grant-supplier',
              businessName: 'Fresh Foods',
            },
          },
          procurementRequests: {
            create: {
              id: 'public-grant-request',
              title: 'Weekly vegetables',
              status: 'OPEN',
              openedAt: now,
              deliveryDetails: { address: 'Grant Kitchen' },
              deliveryDate: new Date('2099-09-02T00:00:00.000Z'),
              quoteDeadline: new Date('2099-09-01T00:00:00.000Z'),
              createdByUserId: 'public-grant-owner',
            },
          },
        },
      });
      await admin.supplierRequest.create({
        data: {
          id: 'public-grant-link',
          tenantId: 'public-grant-tenant',
          requestId: 'public-grant-request',
          supplierId: 'public-grant-supplier',
          tokenDigest: digestOpaqueToken('supplier-request', rawToken),
          expiresAt: new Date('2099-09-01T00:00:00.000Z'),
        },
      });

      await admin.$executeRawUnsafe(
        `ALTER ROLE autorfp_app PASSWORD '${password}'`,
      );
      app = new PrismaClient({
        datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
      });
      await app.$connect();
      const repository = createPrismaPublicSupplierGrantRepository(app);

      await expect(
        exchangeSupplierGrantToken({ token: rawToken, now }, repository),
      ).resolves.toEqual({
        tenantId: 'public-grant-tenant',
        supplierRequestId: 'public-grant-link',
      });
      await expect(app.supplierRequest.findMany()).resolves.toEqual([]);
      expect(await admin.rateLimitBucket.count()).toBe(1);

      for (let index = 0; index < 16; index += 1) {
        const unknownToken = index.toString(36).padStart(43, 'Z');
        await expect(
          exchangeSupplierGrantToken({ token: unknownToken, now }, repository),
        ).rejects.toMatchObject({ code: 'GRANT_UNAVAILABLE', status: 410 });
      }
      expect(await admin.rateLimitBucket.count()).toBe(1);

      await admin.rateLimitBucket.createMany({
        data: [
          ...Array.from({ length: 40 }, (_, index) => ({
            keyDigest: index.toString(16).padStart(64, '0'),
            count: 1,
            resetAt: new Date(now.getTime() - 1_000),
          })),
          {
            keyDigest: 'f'.repeat(64),
            count: 1,
            resetAt: new Date(now.getTime() + 60_000),
          },
        ],
      });
      await consumeDigestRateLimit(
        {
          scope: 'supplier-request',
          subjectDigest: 'e'.repeat(64),
          limit: 5,
          windowMs: 60_000,
          now,
        },
        app,
      );
      expect(
        await admin.rateLimitBucket.count({
          where: { resetAt: { lte: now } },
        }),
      ).toBe(15);
      await expect(
        admin.rateLimitBucket.findUnique({
          where: { keyDigest: 'f'.repeat(64) },
        }),
      ).resolves.not.toBeNull();

      const [functionAcl] = await admin.$queryRaw<
        Array<{
          securityDefiner: boolean;
          settings: string[];
          appCanExecute: boolean;
          publicCanExecute: boolean;
        }>
      >`
        SELECT
          procedure.prosecdef AS "securityDefiner",
          procedure.proconfig AS settings,
          has_function_privilege('autorfp_app', procedure.oid, 'EXECUTE')
            AS "appCanExecute",
          EXISTS (
            SELECT 1
            FROM aclexplode(
              COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
            ) AS permission
            WHERE permission.grantee = 0
              AND permission.privilege_type = 'EXECUTE'
          ) AS "publicCanExecute"
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'autorfp_private'
          AND procedure.proname = 'autorfp_supplier_grant_by_digest'
      `;
      expect(functionAcl).toEqual({
        securityDefiner: true,
        settings: ['search_path=pg_catalog'],
        appCanExecute: true,
        publicCanExecute: false,
      });

      for (const unavailable of [
        () => admin.supplier.update({
          where: {
            tenantId_id: {
              tenantId: 'public-grant-tenant',
              id: 'public-grant-supplier',
            },
          },
          data: { isActive: false },
        }),
        () => admin.procurementRequest.update({
          where: {
            tenantId_id: {
              tenantId: 'public-grant-tenant',
              id: 'public-grant-request',
            },
          },
          data: { status: 'DRAFT' },
        }),
        () => admin.supplierRequest.update({
          where: {
            tenantId_id: {
              tenantId: 'public-grant-tenant',
              id: 'public-grant-link',
            },
          },
          data: { revokedAt: now },
        }),
        () => admin.tenant.update({
          where: { id: 'public-grant-tenant' },
          data: { isActive: false },
        }),
      ]) {
        await admin.supplier.update({
          where: {
            tenantId_id: {
              tenantId: 'public-grant-tenant',
              id: 'public-grant-supplier',
            },
          },
          data: { isActive: true },
        });
        await admin.procurementRequest.update({
          where: {
            tenantId_id: {
              tenantId: 'public-grant-tenant',
              id: 'public-grant-request',
            },
          },
          data: { status: 'OPEN' },
        });
        await admin.supplierRequest.update({
          where: {
            tenantId_id: {
              tenantId: 'public-grant-tenant',
              id: 'public-grant-link',
            },
          },
          data: { revokedAt: null },
        });
        await admin.tenant.update({
          where: { id: 'public-grant-tenant' },
          data: { isActive: true },
        });

        await unavailable();
        await expect(
          exchangeSupplierGrantToken({ token: rawToken, now }, repository),
        ).rejects.toMatchObject({ code: 'GRANT_UNAVAILABLE', status: 410 });
      }
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
