import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  createProcurementRequestDraft,
  listProcurementRequests,
  PROCUREMENT_REQUEST_BODY_BYTES,
  ProcurementRequestConflictError,
  ProcurementRequestNotFoundError,
  ProcurementRequestValidationError,
} from '@/lib/procurement/request-service';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

export type RequestActor = { tenantId: string; userId: string };

export function requestActor(
  account: NonNullable<Awaited<ReturnType<typeof requireAccountContext>>>,
): RequestActor {
  return { tenantId: account.tenant.id, userId: account.user.id };
}

export function requestServiceError(error: unknown) {
  if (error instanceof ProcurementRequestValidationError) {
    return problemResponse(422, 'Invalid procurement request', error.message, {
      errors: error.errors,
    });
  }
  if (error instanceof ProcurementRequestNotFoundError) {
    return problemResponse(
      404,
      'Procurement request not found',
      'The procurement request is unavailable.',
    );
  }
  if (error instanceof ProcurementRequestConflictError) {
    return problemResponse(409, 'Procurement request could not be changed', error.message);
  }
  if (error instanceof AuthorizationError) {
    return problemResponse(403, 'Forbidden', 'You cannot access this procurement request.');
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

export async function GET(request: Request) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }

  const url = new URL(request.url);
  const limitText = url.searchParams.get('limit');
  try {
    const result = await listProcurementRequests({
      actor: requestActor(account),
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: limitText === null ? undefined : Number(limitText),
    });
    return NextResponse.json(result);
  } catch (error) {
    return requestServiceError(error);
  }
}

export async function POST(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Create procurement requests from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const body = await readRequestBody(request);
  if (body instanceof Response) return privateMutationResponse(body);

  try {
    const created = await createProcurementRequestDraft({
      actor: requestActor(account),
      draft: body,
    });
    return privateMutationResponse(NextResponse.json({ request: created }, { status: 201 }));
  } catch (error) {
    return privateMutationResponse(requestServiceError(error));
  }
}
