import { NextResponse } from 'next/server';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import {
  requireAccountContext,
  tenantToAccount,
} from '@/lib/server-account';

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
    account: tenantToAccount(context.tenant),
  }));
}
