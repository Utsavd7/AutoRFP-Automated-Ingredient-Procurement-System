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
  getReviewedMenu,
  MenuConflictError,
  MenuNotFoundError,
  MenuValidationError,
  updateReviewedMenuDraft,
} from '@/lib/menu/menu-service';
import { requireAccountContext } from '@/lib/server-account';

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
  throw error;
}

export async function GET(_request: Request, context: MenuRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }

  const { id } = await context.params;
  try {
    const menu = await getReviewedMenu({
      actor: actorFrom(account),
      menuId: id,
    });
    return NextResponse.json({ menu });
  } catch (error) {
    return menuError(error);
  }
}

export async function PUT(request: Request, context: MenuRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
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

  const { id } = await context.params;
  try {
    const menu = await updateReviewedMenuDraft({
      actor: actorFrom(account),
      menuId: id,
      expectedVersion: expectedVersionFrom(draft),
      draft,
    });
    return NextResponse.json({ menu });
  } catch (error) {
    return menuError(error);
  }
}
