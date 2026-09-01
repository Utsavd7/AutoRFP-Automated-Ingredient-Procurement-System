import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import {
  openProcurementRequest,
  validateOpenRequestInput,
} from '@/lib/procurement/request-service';
import {
  readRequestBody,
  requestActor,
  requestServiceError,
} from '@/lib/procurement/request-http';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';
type RequestRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RequestRouteContext) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Open procurement requests from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const body = await readRequestBody(request);
  if (body instanceof Response) return privateMutationResponse(body);
  const { id } = await context.params;
  try {
    const command = validateOpenRequestInput(body);
    const result = await openProcurementRequest({
      actor: requestActor(account),
      requestId: id,
      expectedVersion: command.expectedVersion,
    });
    return privateMutationResponse(NextResponse.json(result));
  } catch (error) {
    return privateMutationResponse(requestServiceError(error));
  }
}
