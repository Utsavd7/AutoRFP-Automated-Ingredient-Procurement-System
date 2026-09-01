import { NextResponse } from 'next/server';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import { AwardDocumentStorageCorruptionError } from '@/lib/awards/award-document';
import {
  AWARD_BODY_BYTES,
  AwardConflictError,
  AwardNotFoundError,
  AwardSnapshotTooLargeError,
  AwardValidationError,
  createAward,
} from '@/lib/awards/award-service';
import { AuthorizationError } from '@/lib/auth/guards';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { requireAccountContext } from '@/lib/server-account';

type AwardRouteContext = { params: Promise<{ id: string }> };

async function readAwardBody(request: Request) {
  try {
    return await readBoundedJson(request, AWARD_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateResponse(problemResponse(413, 'Request too large', error.message));
    }
    if (error instanceof InvalidJsonBodyError) {
      return privateResponse(
        problemResponse(400, 'Invalid request', 'Provide a valid JSON body.'),
      );
    }
    throw error;
  }
}

export async function POST(request: Request, context: AwardRouteContext) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateResponse(
      rejected === 'CROSS_ORIGIN'
        ? problemResponse(
            403,
            'Request not allowed',
            'Record this award from its original QuotePlate page.',
          )
        : problemResponse(
            415,
            'Unsupported media type',
            'Send this request as application/json.',
          ),
    );
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateResponse(
      problemResponse(401, 'Unauthorized', 'Authentication is required.'),
    );
  }
  const body = await readAwardBody(request);
  if (body instanceof Response) return privateResponse(body);
  const { id } = await context.params;
  try {
    const award = await createAward({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      requestId: id,
      award: body,
    });
    return NextResponse.json(
      { award },
      {
        status: 201,
        headers: {
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  } catch (error) {
    if (error instanceof AwardValidationError) {
      return privateResponse(problemResponse(422, 'Invalid award', error.message, {
        errors: error.errors,
      }));
    }
    if (error instanceof AwardNotFoundError) {
      return privateResponse(problemResponse(
        404,
        'Procurement request not found',
        'The procurement request is unavailable.',
      ));
    }
    if (error instanceof AwardConflictError) {
      return privateResponse(
        problemResponse(409, 'Award could not be recorded', error.message),
      );
    }
    if (error instanceof AwardSnapshotTooLargeError) {
      return privateResponse(
        problemResponse(
          422,
          'Award snapshot is too large',
          error.message,
        ),
      );
    }
    if (error instanceof AwardDocumentStorageCorruptionError) {
      return privateResponse(
        problemResponse(
          503,
          'Award data unavailable',
          'The stored request or quote data could not be verified.',
        ),
      );
    }
    if (error instanceof AuthorizationError) {
      return privateResponse(
        problemResponse(403, 'Forbidden', 'Only an active owner can record an award.'),
      );
    }
    throw error;
  }
}
