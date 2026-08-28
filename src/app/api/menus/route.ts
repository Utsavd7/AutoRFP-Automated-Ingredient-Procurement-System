import { NextResponse } from 'next/server';

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
  throw error;
}

export async function GET(request: Request) {
  const context = await requireAccountContext();
  if (!context) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }

  const url = new URL(request.url);
  const limitText = url.searchParams.get('limit');
  try {
    const result = await listReviewedMenus({
      actor: actorFrom(context),
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: limitText === null ? undefined : Number(limitText),
    });
    return NextResponse.json(result);
  } catch (error) {
    return menuError(error);
  }
}

export async function POST(request: Request) {
  const context = await requireAccountContext();
  if (!context) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }

  let draft: unknown;
  try {
    draft = await readBoundedJson(request, MENU_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return problemResponse(413, 'Request too large', error.message);
    }
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return problemResponse(400, 'Invalid request', 'Provide a valid JSON body.');
  }

  try {
    const menu = await createReviewedMenuDraft({
      actor: actorFrom(context),
      draft,
    });
    return NextResponse.json({ menu }, { status: 201 });
  } catch (error) {
    return menuError(error);
  }
}
