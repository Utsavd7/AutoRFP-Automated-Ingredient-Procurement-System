import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import {
  openProcurementRequest,
  validateOpenRequestInput,
} from '@/lib/procurement/request-service';
import { requireAccountContext } from '@/lib/server-account';
import {
  readRequestBody,
  requestActor,
  requestServiceError,
} from '../../route';

type RequestRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RequestRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }
  const body = await readRequestBody(request);
  if (body instanceof Response) return body;
  const { id } = await context.params;
  try {
    const command = validateOpenRequestInput(body);
    const result = await openProcurementRequest({
      actor: requestActor(account),
      requestId: id,
      expectedVersion: command.expectedVersion,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return requestServiceError(error);
  }
}
