import { NextResponse } from 'next/server';

import {
  requireAccountContext,
  tenantToAccount,
} from '@/lib/server-account';

function privateResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export async function GET() {
  let context;
  try {
    context = await requireAccountContext();
  } catch {
    return privateResponse(NextResponse.json(
      { error: 'Workspace account is temporarily unavailable.' },
      { status: 503 },
    ));
  }
  if (!context) {
    return privateResponse(NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    ));
  }
  return privateResponse(NextResponse.json({
    account: tenantToAccount(context.tenant, context.user.email),
  }));
}
