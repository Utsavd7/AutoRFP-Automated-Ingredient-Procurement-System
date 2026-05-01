import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/server-account';
import { prisma } from '@/lib/prisma';

export async function DELETE() {
  const tenant = await requireTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await prisma.procurementRun.deleteMany({ where: { tenantId: tenant.id } });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const tenant = await requireTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();

  const run = await prisma.procurementRun.create({
    data: {
      tenantId: tenant.id,
      menuText: body.menuText ?? null,
      totalSpend: body.totalSpend != null ? Number(body.totalSpend) : null,
      totalSavings: body.totalSavings != null ? Number(body.totalSavings) : null,
      savingsPercentage: body.savingsPercentage != null ? Number(body.savingsPercentage) : null,
      bestVendor: body.winner ?? body.bestVendor ?? null,
      winnerPrice: body.winnerPrice != null ? Number(body.winnerPrice) : null,
      recipesCount: Number(body.recipesCount ?? 0),
      ingredientsCount: Number(body.ingredientsCount ?? 0),
      distributorsCount: Number(body.distributorsCount ?? 0),
      quotesCount: Number(body.quotesCount ?? 0),
      executiveSummary: body.executiveSummary ?? null,
      marketAlerts: Array.isArray(body.marketAlerts) ? body.marketAlerts : [],
    },
  });

  return NextResponse.json({ run });
}
