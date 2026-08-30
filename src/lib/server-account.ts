import type { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { loadCurrentUser } from '@/lib/auth/current-user';

type TenantAccount = Prisma.TenantGetPayload<Record<string, never>>;

export function tenantToAccount(tenant: TenantAccount) {
  return {
    name: tenant.name,
    addressLine: tenant.addressLine,
    city: tenant.city,
    state: tenant.state,
    pin: tenant.pin,
  };
}

export async function requireAccountContext() {
  const session = await getServerSession(authOptions);
  const user = await loadCurrentUser({
    userId: session?.user?.userId,
    tenantId: session?.user?.tenantId,
  });
  if (!user) return null;
  return { tenant: user.tenant, user };
}
