import { Prisma, type PrismaClient } from '@prisma/client';

import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { prisma } from '@/lib/prisma';

export type TenantTransactionHost = Pick<
  PrismaClient,
  '$queryRaw' | '$transaction'
>;

const transactionOptions = {
  maxWait: 2_000,
  timeout: 5_000,
} as const;

function validTenantId(tenantId: string) {
  return (
    tenantId.length > 0 &&
    tenantId.length <= 200 &&
    tenantId.trim() === tenantId &&
    !/[\u0000-\u001f\u007f]/.test(tenantId)
  );
}

export async function withTenant<T>(
  tenantId: string,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  client: TenantTransactionHost = prisma,
) {
  if (!validTenantId(tenantId)) {
    throw new TypeError('A valid tenant ID is required.');
  }

  await assertRuntimeDatabaseRole(client);
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT set_config('app.tenant_id', ${tenantId}, true)
    `;
    return callback(transaction);
  }, transactionOptions);
}
