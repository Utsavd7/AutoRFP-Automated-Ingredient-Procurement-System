import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import {
  changeSupplierRequestLink,
  validateLinkActionInput,
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
      ? problemResponse(403, 'Request not allowed', 'Manage supplier links from the QuotePlate workspace page.')
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
    const command = validateLinkActionInput(body);
    const result = await changeSupplierRequestLink({
      actor: requestActor(account),
      requestId: id,
      supplierRequestId: command.supplierRequestId,
      expectedVersion: command.expectedVersion,
      action: command.action,
    });
    return privateMutationResponse(NextResponse.json(result));
  } catch (error) {
    return privateMutationResponse(requestServiceError(error));
  }
}
