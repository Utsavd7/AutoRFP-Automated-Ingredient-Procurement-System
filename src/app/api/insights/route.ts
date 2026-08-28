import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import { getFactualInsights } from '@/lib/reporting/reporting-service';
import { requireAccountContext } from '@/lib/server-account';

function privateResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

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
