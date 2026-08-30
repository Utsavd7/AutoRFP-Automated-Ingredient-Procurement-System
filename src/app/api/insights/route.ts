import { NextResponse } from 'next/server';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import { getFactualInsights } from '@/lib/reporting/reporting-service';
import { requireAccountContext } from '@/lib/server-account';

export async function GET() {
  const account = await requireAccountContext();
  if (!account) return privateResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  try {
    const insights = await getFactualInsights({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
    });
    return privateResponse(NextResponse.json(insights));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return privateResponse(problemResponse(403, 'Forbidden', 'You cannot view these insights.'));
    }
    throw error;
  }
}
