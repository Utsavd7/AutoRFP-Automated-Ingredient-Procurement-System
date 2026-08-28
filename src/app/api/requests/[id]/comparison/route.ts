import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  getQuoteComparison,
  QuoteComparisonNotFoundError,
} from '@/lib/comparison/compare-quotes';
import { requireAccountContext } from '@/lib/server-account';

type ComparisonRouteContext = { params: Promise<{ id: string }> };

function privateResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(_request: Request, context: ComparisonRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return privateResponse(
      problemResponse(401, 'Unauthorized', 'Authentication is required.'),
    );
  }
  const { id } = await context.params;
  try {
    const comparison = await getQuoteComparison({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      requestId: id,
    });
    return NextResponse.json(comparison, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof QuoteComparisonNotFoundError) {
      return privateResponse(problemResponse(
        404,
        'Procurement request not found',
        'The procurement request is unavailable.',
      ));
    }
    if (error instanceof AuthorizationError) {
      return privateResponse(
        problemResponse(403, 'Forbidden', 'You cannot access this comparison.'),
      );
    }
    throw error;
  }
}
