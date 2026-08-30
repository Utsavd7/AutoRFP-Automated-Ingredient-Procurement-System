import { NextResponse } from 'next/server';
import { Prisma, type PrismaClient } from '@prisma/client';

import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { validateRuntimeEnvironment } from '@/lib/env';

type ReadinessDatabaseClient = Pick<PrismaClient, '$queryRaw'>;

type ReadinessDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  checkDatabase: () => Promise<unknown>;
  timeoutMs: number;
};

function healthResponse(status: 200 | 503, state: 'ready' | 'unavailable') {
  return NextResponse.json(
    { status: state },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

async function within<T>(work: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Readiness timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function checkRuntimeDatabase(client: ReadinessDatabaseClient) {
  await assertRuntimeDatabaseRole(client);
  const [migration] = await client.$queryRaw<Array<{ migrationReady: boolean }>>(
    Prisma.sql`
      SELECT (
        to_regclass('public."User"') IS NOT NULL
        AND to_regclass('public."Recipe"') IS NOT NULL
        AND to_regclass('public."RequestItem"') IS NOT NULL
        AND to_regclass('public."Supplier"') IS NOT NULL
        AND to_regclass('public."RateLimitBucket"') IS NOT NULL
        AND NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid IN (
            to_regclass('public."Recipe"'),
            to_regclass('public."RequestItem"'),
            to_regclass('public."Supplier"')
          )
            AND attribute.attname IN (
              'retiredAt',
              'sourceIngredientId',
              'verifiedAt',
              'verifiedByUserId'
            )
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public."User"')
            AND attribute.attname = 'legacyPasswordSalt'
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public."RateLimitBucket"')
            AND attribute.attname = 'updatedAt'
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )
      ) AS "migrationReady"
    `,
  );
  if (!migration?.migrationReady) {
    throw new Error('The required database migration is not ready.');
  }
}

export function createReadinessHandler(
  dependencies: ReadinessDependencies,
) {
  return async function readiness() {
    try {
      validateRuntimeEnvironment(dependencies.environment);
      await within(dependencies.checkDatabase(), dependencies.timeoutMs);
      return healthResponse(200, 'ready');
    } catch {
      return healthResponse(503, 'unavailable');
    }
  };
}
