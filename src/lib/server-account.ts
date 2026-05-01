import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export function tenantToAccount(tenant: Awaited<ReturnType<typeof prisma.tenant.findUnique>> extends infer T ? NonNullable<T> : never) {
  return {
    tenantId: tenant.id,
    name: tenant.restaurantName,
    email: tenant.email,
    location: tenant.location,
    cuisineType: tenant.cuisineType || 'General restaurant',
    preferredSuppliers: tenant.preferredSuppliers,
    monthlyBudgetTarget: tenant.monthlyBudgetTarget,
    savingsTargetPct: tenant.savingsTargetPct,
    createdAt: tenant.createdAt.toISOString(),
  };
}

export async function requireTenant() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;
  return tenant;
}
