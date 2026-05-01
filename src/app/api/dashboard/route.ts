import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/server-account';
import { prisma } from '@/lib/prisma';

function runToRecord(run: any) {
  return {
    id: run.id,
    date: run.createdAt.toISOString(),
    tenantId: run.tenantId,
    restaurantName: run.tenant?.restaurantName ?? '',
    menuText: run.menuText ?? undefined,
    recipesCount: run.recipesCount,
    ingredientsCount: run.ingredientsCount,
    distributorsCount: run.distributorsCount,
    quotesCount: run.quotesCount,
    totalSpend: run.totalSpend ?? undefined,
    winner: run.bestVendor ?? undefined,
    winnerPrice: run.winnerPrice ?? undefined,
    totalSavings: run.totalSavings ?? undefined,
    savingsPercentage: run.savingsPercentage ?? undefined,
    executiveSummary: run.executiveSummary ?? undefined,
    marketAlerts: run.marketAlerts ?? [],
  };
}

export async function GET() {
  const tenant = await requireTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [runs, activeRfp] = await Promise.all([
    prisma.procurementRun.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { tenant: true },
    }),
    prisma.rFP.findFirst({
      where: { tenantId: tenant.id, status: { in: ['SENT', 'REPLIED'] } },
      orderBy: { createdAt: 'desc' },
      include: { menu: { include: { recipes: { include: { ingredients: true } } } }, quotes: true },
    }),
  ]);

  return NextResponse.json({
    history: runs.map(runToRecord),
    activeRfp: activeRfp ? {
      id: activeRfp.menuId,
      date: activeRfp.createdAt.toISOString(),
      tenantId: tenant.id,
      restaurantName: tenant.restaurantName,
      ingredientsCount: activeRfp.menu.recipes.reduce((sum, recipe) => sum + recipe.ingredients.length, 0),
      distributorsCount: 1,
      quotesCount: activeRfp.quotes.length,
      status: activeRfp.status === 'REPLIED' ? 'Quotes received' : 'RFPs in market',
    } : null,
  });
}
