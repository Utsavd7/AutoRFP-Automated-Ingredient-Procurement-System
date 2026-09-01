import { NextResponse } from 'next/server';

import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  MENU_REQUEST_BODY_BYTES,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  createReviewedMenuDraft,
  listReviewedMenus,
  MenuValidationError,
} from '@/lib/menu/menu-service';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

function actorFrom(context: NonNullable<Awaited<ReturnType<typeof requireAccountContext>>>) {
  return { userId: context.user.id, tenantId: context.tenant.id };
}

function menuError(error: unknown) {
  if (error instanceof MenuValidationError) {
    return problemResponse(422, 'Invalid menu', error.message, {
      errors: error.errors,
    });
  }
  if (error instanceof AuthorizationError) {
    return problemResponse(403, 'Forbidden', 'You cannot access this menu.');
  }
  return problemResponse(
    500,
    'Unable to complete menu request',
    'The menu request could not be completed. Try again.',
  );
}

export async function GET(request: Request) {
  const context = await requireAccountContext();
  if (!context) {
    return privateNoStoreResponse(
      problemResponse(401, 'Unauthorized', 'Authentication is required.'),
    );
  }

  const url = new URL(request.url);
  const limitText = url.searchParams.get('limit');
  try {
    const result = await listReviewedMenus({
      actor: actorFrom(context),
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: limitText === null ? undefined : Number(limitText),
    });
    return privateNoStoreResponse(NextResponse.json(result));
  } catch (error) {
    return privateNoStoreResponse(menuError(error));
  }
}

export async function POST(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Create menus from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const context = await requireAccountContext();
  if (!context) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }

  let draft: unknown;
  try {
    draft = await readBoundedJson(request, MENU_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateMutationResponse(problemResponse(413, 'Request too large', error.message));
    }
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return privateMutationResponse(problemResponse(400, 'Invalid request', 'Provide a valid JSON body.'));
  }

  try {
    const menu = await createReviewedMenuDraft({
      actor: actorFrom(context),
      draft,
    });
    return privateMutationResponse(NextResponse.json({ menu }, { status: 201 }));
  } catch (error) {
    return privateMutationResponse(menuError(error));
  }
}
