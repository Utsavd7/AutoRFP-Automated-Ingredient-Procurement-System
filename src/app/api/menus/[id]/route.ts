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
  getReviewedMenu,
  MenuConflictError,
  MenuNotFoundError,
  MenuValidationError,
  updateReviewedMenuDraft,
} from '@/lib/menu/menu-service';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

type MenuRouteContext = { params: Promise<{ id: string }> };

function expectedVersionFrom(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).expectedVersion
    : undefined;
}

function actorFrom(context: NonNullable<Awaited<ReturnType<typeof requireAccountContext>>>) {
  return { userId: context.user.id, tenantId: context.tenant.id };
}

function menuError(error: unknown) {
  if (error instanceof MenuNotFoundError) {
    return problemResponse(404, 'Menu not found', 'The menu is unavailable.');
  }
  if (error instanceof MenuValidationError) {
    return problemResponse(422, 'Invalid menu', error.message, {
      errors: error.errors,
    });
  }
  if (error instanceof MenuConflictError) {
    return problemResponse(409, 'Menu could not be changed', error.message);
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

export async function GET(_request: Request, context: MenuRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return privateNoStoreResponse(
      problemResponse(401, 'Unauthorized', 'Authentication is required.'),
    );
  }

  const { id } = await context.params;
  try {
    const menu = await getReviewedMenu({
      actor: actorFrom(account),
      menuId: id,
    });
    return privateNoStoreResponse(NextResponse.json({ menu }));
  } catch (error) {
    return privateNoStoreResponse(menuError(error));
  }
}

export async function PUT(request: Request, context: MenuRouteContext) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Edit menus from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
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

  const { id } = await context.params;
  try {
    const menu = await updateReviewedMenuDraft({
      actor: actorFrom(account),
      menuId: id,
      expectedVersion: expectedVersionFrom(draft),
      draft,
    });
    return privateMutationResponse(NextResponse.json({ menu }));
  } catch (error) {
    return privateMutationResponse(menuError(error));
  }
}
