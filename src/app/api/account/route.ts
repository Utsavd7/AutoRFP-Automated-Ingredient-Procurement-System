import { NextResponse } from 'next/server';
import { requireTenant, tenantToAccount } from '@/lib/server-account';
import { prisma } from '@/lib/prisma';
import { parseSuppliers } from '@/lib/tenant';

export async function GET() {
  const tenant = await requireTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ account: tenantToAccount(tenant) });
}

export async function PUT(req: Request) {
  const tenant = await requireTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const location = String(body.location ?? '').trim();
  const cuisineType = String(body.cuisineType ?? '').trim() || 'General restaurant';

  if (!name || !email.includes('@') || !location) {
    return NextResponse.json({ error: 'Restaurant name, email, and location are required.' }, { status: 400 });
  }

  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      restaurantName: name,
      email,
      location,
      cuisineType,
      preferredSuppliers: Array.isArray(body.preferredSuppliers)
        ? body.preferredSuppliers
        : parseSuppliers(String(body.preferredSuppliers ?? '')),
      monthlyBudgetTarget: body.monthlyBudgetTarget != null && body.monthlyBudgetTarget !== '' ? Number(body.monthlyBudgetTarget) : null,
      savingsTargetPct: body.savingsTargetPct != null && body.savingsTargetPct !== '' ? Number(body.savingsTargetPct) : null,
    },
  });

  return NextResponse.json({ account: tenantToAccount(updated) });
}
