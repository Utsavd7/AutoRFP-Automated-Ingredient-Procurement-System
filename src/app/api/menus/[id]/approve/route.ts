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
  approveReviewedMenu,
  MenuConflictError,
  MenuNotFoundError,
  MenuValidationError,
} from '@/lib/menu/menu-service';
import { requireAccountContext } from '@/lib/server-account';

type MenuRouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: MenuRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }

  let body: unknown;
  try {
    body = await readBoundedJson(_request, MENU_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return problemResponse(413, 'Request too large', error.message);
    }
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return problemResponse(400, 'Invalid request', 'Provide a valid JSON body.');
  }

  const expectedVersion =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).expectedVersion
      : undefined;
  const { id } = await context.params;
  try {
    const menu = await approveReviewedMenu({
      actor: { userId: account.user.id, tenantId: account.tenant.id },
      menuId: id,
      expectedVersion,
    });
    return NextResponse.json({ menu });
  } catch (error) {
    if (error instanceof MenuNotFoundError) {
      return problemResponse(404, 'Menu not found', 'The menu is unavailable.');
    }
    if (error instanceof MenuConflictError) {
      return problemResponse(409, 'Menu is not ready', error.message);
    }
    if (error instanceof MenuValidationError) {
      return problemResponse(422, 'Invalid menu', error.message, {
        errors: error.errors,
      });
    }
    if (error instanceof AuthorizationError) {
      return problemResponse(403, 'Forbidden', 'You cannot approve this menu.');
    }
    throw error;
  }
}
