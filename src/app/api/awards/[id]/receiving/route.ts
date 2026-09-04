import { NextResponse } from 'next/server';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  ReceivingStorageCorruptionError,
  ReceivingValidationError,
} from '@/lib/receiving/receiving-document';
import {
  RECEIVING_BODY_BYTES,
  recordDeliveryCheck,
  ReceivingConflictError,
  ReceivingNotFoundError,
  ReceivingSupplierError,
} from '@/lib/receiving/receiving-service';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { requireAccountContext } from '@/lib/server-account';

type ReceivingRouteContext = { params: Promise<{ id: string }> };

async function readBody(request: Request) {
  try {
    return await readBoundedJson(request, RECEIVING_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateResponse(problemResponse(413, 'Request too large', error.message));
    }
    if (error instanceof InvalidJsonBodyError) {
      return privateResponse(problemResponse(400, 'Invalid request', 'Provide a valid JSON body.'));
    }
    throw error;
  }
}

export async function POST(request: Request, context: ReceivingRouteContext) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Check this delivery from its original QuotePlate page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const body = await readBody(request);
  if (body instanceof Response) return privateResponse(body);
  const { id } = await context.params;

  try {
    const check = await recordDeliveryCheck({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      awardId: id,
      check: body,
    });
    return privateResponse(NextResponse.json({ check }));
  } catch (error) {
    if (error instanceof ReceivingValidationError) {
      return privateResponse(problemResponse(422, 'Check the delivery details', error.message));
    }
    if (error instanceof ReceivingNotFoundError) {
      return privateResponse(problemResponse(404, 'Award not found', 'The recorded award is unavailable.'));
    }
    if (error instanceof ReceivingSupplierError) {
      return privateResponse(problemResponse(409, 'Supplier not awarded', error.message));
    }
    if (error instanceof ReceivingConflictError) {
      return privateResponse(problemResponse(409, 'Delivery check changed', error.message));
    }
    if (error instanceof AuthorizationError) {
      return privateResponse(problemResponse(403, 'Forbidden', 'Only an active restaurant team member can check a delivery.'));
    }
    if (error instanceof ReceivingStorageCorruptionError) {
      return privateResponse(problemResponse(503, 'Delivery checks unavailable', 'The saved delivery checks could not be verified.'));
    }
    throw error;
  }
}
