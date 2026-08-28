import { NextResponse } from 'next/server';

import {
  requireAccountContext,
  tenantToAccount,
} from '@/lib/server-account';
import { updateWorkspaceAccount } from '@/lib/account/update-workspace';
import { AuthorizationError, requireOwner } from '@/lib/auth/guards';

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
  try {
    requireOwner(context.user, 'manage-settings');
  } catch {
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

  let updated;
  try {
    updated = await updateWorkspaceAccount({
      actor: { userId: context.user.id, tenantId: context.tenant.id },
      name,
      email,
      addressLine,
      city,
      state,
      pin,
      phone,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    throw error;
  }

  return NextResponse.json({
    account: tenantToAccount(updated.tenant, updated.user.email),
  });
}
