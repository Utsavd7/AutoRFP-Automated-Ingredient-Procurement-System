import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export type StableSessionClaims = {
  userId?: string;
  tenantId?: string;
};

export type CurrentUser = Prisma.UserGetPayload<{ include: { tenant: true } }>;

export type CurrentUserStore = {
  user: {
    findFirst(args: {
      where: {
        id: string;
        tenantId: string;
        isActive: true;
        tenant: { isActive: true };
      };
      include: { tenant: true };
    }): Promise<CurrentUser | null>;
  };
};

export async function loadCurrentUser(
  claims: StableSessionClaims,
  store: CurrentUserStore = prisma as unknown as CurrentUserStore,
) {
  if (!claims.userId || !claims.tenantId) return null;

  return store.user.findFirst({
    where: {
      id: claims.userId,
      tenantId: claims.tenantId,
      isActive: true,
      tenant: { isActive: true },
    },
    include: { tenant: true },
  });
}
