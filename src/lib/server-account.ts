import type { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type TenantAccount = Prisma.TenantGetPayload<Record<string, never>>;

export function tenantToAccount(tenant: TenantAccount, email: string) {
  return {
    tenantId: tenant.id,
    name: tenant.name,
    email,
    location: tenant.addressLine,
    cuisineType: 'General restaurant',
    preferredSuppliers: [],
    monthlyBudgetTarget: null,
    savingsTargetPct: null,
    addressLine: tenant.addressLine,
    city: tenant.city,
    state: tenant.state,
    pin: tenant.pin,
    phone: tenant.phone,
    timezone: tenant.timezone,
    gstin: tenant.gstin,
    createdAt: tenant.createdAt.toISOString(),
  };
}

export async function requireAccountContext() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return null;

  const user = await prisma.user.findFirst({
    where: {
      tenantId,
      isActive: true,
      ...(session.user?.userId
        ? { id: session.user.userId }
        : session.user?.email
          ? { email: session.user.email.toLowerCase() }
          : { id: '__missing_authenticated_user__' }),
    },
    include: { tenant: true },
  });
  if (!user?.tenant.isActive) return null;
  return { tenant: user.tenant, user };
}

export async function requireTenant() {
  const context = await requireAccountContext();
  return context?.tenant ?? null;
}
