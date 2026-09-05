import type { Prisma } from '@prisma/client';

import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';

export type StableSessionClaims = {
  userId?: string;
  tenantId?: string;
};

const currentUserSelect = {
  id: true,
  tenantId: true,
  role: true,
  accountState: true,
  isActive: true,
  tutorialVersion: true,
  tutorialStep: true,
  tutorialSkippedAt: true,
  tutorialCompletedAt: true,
  tenant: true,
} satisfies Prisma.UserSelect;

export type CurrentUser = Prisma.UserGetPayload<{ select: typeof currentUserSelect }>;

export type CurrentUserStore = {
  findCurrent(userId: string, tenantId: string): Promise<CurrentUser | null>;
};

export function createPrismaCurrentUserStore(
  client: TenantTransactionHost,
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
              accountState: 'ACTIVE',
              isActive: true,
              tenant: { isActive: true },
            },
            select: currentUserSelect,
          }),
        client,
      );
    },
  };
}

const prismaCurrentUserStore = createPrismaCurrentUserStore(prisma);

export async function loadCurrentUser(
  claims: StableSessionClaims,
  store: CurrentUserStore = prismaCurrentUserStore,
) {
  if (!claims.userId || !claims.tenantId) return null;

  return store.findCurrent(claims.userId, claims.tenantId);
}
