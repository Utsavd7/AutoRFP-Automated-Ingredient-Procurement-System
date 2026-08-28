import { NextResponse } from 'next/server';

import {
  requireAccountContext,
  tenantToAccount,
} from '@/lib/server-account';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const context = await requireAccountContext();
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    account: tenantToAccount(context.tenant, context.user.email),
  });
}

export async function PUT(req: Request) {
  const context = await requireAccountContext();
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (context.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const addressLine = String(
    body.addressLine ?? body.location ?? context.tenant.addressLine,
  ).trim();
  const city = String(body.city ?? context.tenant.city).trim();
  const state = String(body.state ?? context.tenant.state).trim();
  const pin = String(body.pin ?? context.tenant.pin).trim();
  const phone = String(body.phone ?? context.tenant.phone).trim();

  if (
    !name ||
    !email.includes('@') ||
    !addressLine ||
    !city ||
    !state ||
    !pin ||
    !phone
  ) {
    return NextResponse.json(
      { error: 'Restaurant, email, address, city, state, PIN, and phone are required.' },
      { status: 400 },
    );
  }

  const [tenant, user] = await prisma.$transaction([
    prisma.tenant.update({
      where: { id: context.tenant.id },
      data: { name, addressLine, city, state, pin, phone },
    }),
    prisma.user.update({
      where: { id: context.user.id },
      data: { name: `${name} Owner`, email },
    }),
  ]);

  return NextResponse.json({ account: tenantToAccount(tenant, user.email) });
}
