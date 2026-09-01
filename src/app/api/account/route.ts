import { NextResponse } from 'next/server';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import {
  requireAccountContext,
  tenantToAccount,
} from '@/lib/server-account';
import {
  tutorialStateDto,
  tutorialStateFromUser,
} from '@/lib/tutorial/tutorial-state';

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
    workspaceId: context.tenant.id,
    account: tenantToAccount(context.tenant),
    tutorial: tutorialStateDto(tutorialStateFromUser(context.user)),
  }));
}
