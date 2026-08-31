import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { privateNoStoreResponse } from '@/lib/api/private-response';
import {
  getProcurementRequest,
  updateProcurementRequestDraft,
} from '@/lib/procurement/request-service';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';
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
    return privateNoStoreResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const { id } = await context.params;
  try {
    const procurementRequest = await getProcurementRequest({
      actor: requestActor(account),
      requestId: id,
    });
    return privateNoStoreResponse(NextResponse.json({ request: procurementRequest }));
  } catch (error) {
    return requestServiceError(error);
  }
}

export async function PATCH(request: Request, context: RequestRouteContext) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Edit procurement requests from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const body = await readRequestBody(request);
  if (body instanceof Response) return privateMutationResponse(body);
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
    return privateMutationResponse(NextResponse.json({ request: updated }));
  } catch (error) {
    return privateMutationResponse(requestServiceError(error));
  }
}
