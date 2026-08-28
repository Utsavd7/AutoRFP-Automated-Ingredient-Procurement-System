import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import {
  getProcurementRequest,
  updateProcurementRequestDraft,
} from '@/lib/procurement/request-service';
import { requireAccountContext } from '@/lib/server-account';
import {
  readRequestBody,
  requestActor,
  requestServiceError,
} from '../route';

type RequestRouteContext = { params: Promise<{ id: string }> };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(_request: Request, context: RequestRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }
  const { id } = await context.params;
  try {
    const procurementRequest = await getProcurementRequest({
      actor: requestActor(account),
      requestId: id,
    });
    return NextResponse.json({ request: procurementRequest });
  } catch (error) {
    return requestServiceError(error);
  }
}

export async function PATCH(request: Request, context: RequestRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }
  const body = await readRequestBody(request);
  if (body instanceof Response) return body;
  const values = record(body);
  const { expectedVersion, ...patch } = values;
  const { id } = await context.params;
  try {
    const updated = await updateProcurementRequestDraft({
      actor: requestActor(account),
      requestId: id,
      expectedVersion,
      patch,
    });
    return NextResponse.json({ request: updated });
  } catch (error) {
    return requestServiceError(error);
  }
}
