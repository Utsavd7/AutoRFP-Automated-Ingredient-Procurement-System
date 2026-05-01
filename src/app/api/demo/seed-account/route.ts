import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createPasswordRecord } from '@/lib/password';
import { makeTenantId } from '@/lib/tenant';

const DEMO_EMAIL = 'demo@autorfp.local';
const DEMO_PASSWORD = 'demo-password';
const DEMO_NAME = 'Demo Bistro Group';

export async function POST() {
  const id = makeTenantId(DEMO_EMAIL, DEMO_NAME);
  const passwordRecord = createPasswordRecord(DEMO_PASSWORD);
  const tenant = await prisma.tenant.upsert({
    where: { id },
    update: {
      ...passwordRecord,
      restaurantName: DEMO_NAME,
      email: DEMO_EMAIL,
      location: 'New York, NY',
      cuisineType: 'Modern American',
      preferredSuppliers: ['Baldor', 'US Foods', 'Century Wholesale'],
      monthlyBudgetTarget: 52000,
      savingsTargetPct: 12,
    },
    create: {
      id,
      ...passwordRecord,
      restaurantName: DEMO_NAME,
      email: DEMO_EMAIL,
      location: 'New York, NY',
      cuisineType: 'Modern American',
      preferredSuppliers: ['Baldor', 'US Foods', 'Century Wholesale'],
      monthlyBudgetTarget: 52000,
      savingsTargetPct: 12,
    },
  });

  return NextResponse.json({
    account: {
      tenantId: tenant.id,
      name: tenant.restaurantName,
      email: tenant.email,
      location: tenant.location,
      cuisineType: tenant.cuisineType,
      preferredSuppliers: tenant.preferredSuppliers,
      monthlyBudgetTarget: tenant.monthlyBudgetTarget,
      savingsTargetPct: tenant.savingsTargetPct,
      createdAt: tenant.createdAt.toISOString(),
    },
  });
}
