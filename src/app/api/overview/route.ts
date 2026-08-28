import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import { getOverview } from '@/lib/overview/overview-service';
import { requireAccountContext } from '@/lib/server-account';

export const dynamic = 'force-dynamic';

function privateResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Cookie');
  return response;
}

export async function GET() {
  const account = await requireAccountContext();
  if (!account) {
    return privateResponse(
      problemResponse(401, 'Unauthorized', 'Authentication is required.'),
    );
  }

  try {
    const overview = await getOverview({
      actor: {
        tenantId: account.tenant.id,
        userId: account.user.id,
      },
    });
    return privateResponse(NextResponse.json({ overview }));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return privateResponse(
        problemResponse(403, 'Forbidden', 'This workspace is unavailable.'),
      );
    }
    throw error;
  }
}
