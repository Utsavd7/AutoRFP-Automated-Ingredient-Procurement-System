import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import {
  changeSupplierRequestLink,
  validateLinkActionInput,
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
    const command = validateLinkActionInput(body);
    const result = await changeSupplierRequestLink({
      actor: requestActor(account),
      requestId: id,
      supplierRequestId: command.supplierRequestId,
      expectedVersion: command.expectedVersion,
      action: command.action,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return requestServiceError(error);
  }
}
