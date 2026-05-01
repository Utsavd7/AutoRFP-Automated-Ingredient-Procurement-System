import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildActiveRfpSummary, isActiveMenuWorkflowStatus, isActiveRfpStatus } from '@/lib/rfp';
import { requireTenant } from '@/lib/server-account';

export async function GET() {
  const tenant = await requireTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const menu = await prisma.menu.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { lastActivityAt: 'desc' },
    include: {
      recipes: { include: { ingredients: true } },
      rfps: {
        include: {
          distributor: true,
          quotes: { orderBy: { submittedAt: 'asc' } },
        },
      },
    },
  });

  if (!menu) return NextResponse.json({ session: null, activeRfp: null });

  const activeRfps = menu.rfps.filter(rfp => isActiveRfpStatus(rfp.status));
  const isWorkflowActive = isActiveMenuWorkflowStatus(menu.workflowStatus);
  if (!activeRfps.length && !isWorkflowActive) {
    return NextResponse.json({ session: null, activeRfp: null });
  }

  const quotes = activeRfps
    .flatMap(rfp => rfp.quotes.map(quote => ({
      ...quote,
      distributorName: rfp.distributor.name,
      distributorLocation: rfp.distributor.location,
      rfpId: rfp.id,
      lifecycleStatus: rfp.status,
    })))
    .sort((a, b) => a.price - b.price);

  const session = {
    menuId: menu.id,
    menuText: menu.text,
    mealName: menu.mealName,
    guestCount: menu.guestCount,
    bufferPct: menu.bufferPct,
    workflowStatus: menu.workflowStatus,
    recipes: menu.recipes,
    ingredients: Array.isArray(menu.requestedIngredients) ? menu.requestedIngredients : [],
    sentRFPs: activeRfps.map(rfp => ({
      id: rfp.id,
      tenantId: rfp.tenantId,
      distributorName: rfp.distributor.name,
      distributorLocation: rfp.distributor.location,
      status: rfp.status,
      email: rfp.distributor.email,
      viewedAt: rfp.viewedAt,
      repliedAt: rfp.repliedAt,
      expiresAt: rfp.expiresAt,
    })),
    quotes,
  };

  return NextResponse.json({
    session,
    activeRfp: buildActiveRfpSummary({
      menu,
      tenantId: tenant.id,
      restaurantName: tenant.restaurantName,
      rfps: activeRfps,
    }),
  });
}

export async function DELETE() {
  const tenant = await requireTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const menu = await prisma.menu.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { lastActivityAt: 'desc' },
    include: { rfps: true },
  });

  if (!menu) return NextResponse.json({ ok: true });

  const activeIds = menu.rfps.filter(rfp => isActiveRfpStatus(rfp.status)).map(rfp => rfp.id);

  await prisma.$transaction([
    prisma.menu.update({
      where: { id: menu.id },
      data: {
        workflowStatus: 'CANCELLED',
        lastActivityAt: new Date(),
      },
    }),
    ...(activeIds.length
      ? [
          prisma.rFP.updateMany({
            where: { id: { in: activeIds } },
            data: { status: 'CANCELLED' },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
