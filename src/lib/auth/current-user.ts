import type { Prisma, PrismaClient } from '@prisma/client';

import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';

export type StableSessionClaims = {
  userId?: string;
  tenantId?: string;
};

export type CurrentUser = Prisma.UserGetPayload<{ include: { tenant: true } }>;

export type CurrentUserStore = {
  findCurrent(userId: string, tenantId: string): Promise<CurrentUser | null>;
};

type CurrentUserClient = Pick<PrismaClient, '$queryRaw' | '$transaction'> &
  TenantTransactionHost;

export function createPrismaCurrentUserStore(
  client: CurrentUserClient,
): CurrentUserStore {
  return {
    findCurrent(userId, tenantId) {
      return withTenant(
        tenantId,
        (transaction) =>
          transaction.user.findFirst({
            where: {
              id: userId,
              tenantId,
              isActive: true,
              tenant: { isActive: true },
            },
            include: { tenant: true },
          }),
        client,
      );
    },
  };
}

export const prismaCurrentUserStore = createPrismaCurrentUserStore(prisma);

export async function loadCurrentUser(
  claims: StableSessionClaims,
  store: CurrentUserStore = prismaCurrentUserStore,
) {
  if (!claims.userId || !claims.tenantId) return null;

  return store.findCurrent(claims.userId, claims.tenantId);
}
