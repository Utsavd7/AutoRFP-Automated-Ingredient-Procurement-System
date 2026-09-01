import { problemResponse } from '@/lib/api/problem';
import { privateNoStoreResponse } from '@/lib/api/private-response';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  PROCUREMENT_REQUEST_BODY_BYTES,
  ProcurementRequestConflictError,
  ProcurementRequestNotFoundError,
  ProcurementRequestValidationError,
} from '@/lib/procurement/request-service';
import type { requireAccountContext } from '@/lib/server-account';

export type RequestActor = { tenantId: string; userId: string };

export function requestActor(
  account: NonNullable<Awaited<ReturnType<typeof requireAccountContext>>>,
): RequestActor {
  return { tenantId: account.tenant.id, userId: account.user.id };
}

export function requestServiceError(error: unknown) {
  if (error instanceof ProcurementRequestValidationError) {
    return privateNoStoreResponse(problemResponse(422, 'Invalid procurement request', error.message, {
      errors: error.errors,
    }));
  }
  if (error instanceof ProcurementRequestNotFoundError) {
    return privateNoStoreResponse(problemResponse(
      404,
      'Procurement request not found',
      'The procurement request is unavailable.',
    ));
  }
  if (error instanceof ProcurementRequestConflictError) {
    return privateNoStoreResponse(problemResponse(409, 'Procurement request could not be changed', error.message));
  }
  if (error instanceof AuthorizationError) {
    return privateNoStoreResponse(problemResponse(403, 'Forbidden', 'You cannot access this procurement request.'));
  }
  throw error;
}

export async function readRequestBody(request: Request) {
  try {
    return await readBoundedJson(request, PROCUREMENT_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return problemResponse(413, 'Request too large', error.message);
    }
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return problemResponse(400, 'Invalid request', 'Provide a valid JSON body.');
  }
}
