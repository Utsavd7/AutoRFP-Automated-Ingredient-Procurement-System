import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  listProcurementHistory,
  ReportingValidationError,
} from '@/lib/reporting/reporting-service';
import { requireAccountContext } from '@/lib/server-account';

function privateResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export async function GET(request: Request) {
  const account = await requireAccountContext();
  if (!account) return privateResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  const url = new URL(request.url);
  const limit = url.searchParams.get('limit');
  try {
    const history = await listProcurementHistory({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: limit === null ? undefined : Number(limit),
    });
    return privateResponse(NextResponse.json(history));
  } catch (error) {
    if (error instanceof ReportingValidationError) {
      return privateResponse(problemResponse(422, 'Invalid history request', error.message, { errors: error.errors }));
    }
    if (error instanceof AuthorizationError) {
      return privateResponse(problemResponse(403, 'Forbidden', 'You cannot view this history.'));
    }
    throw error;
  }
}
