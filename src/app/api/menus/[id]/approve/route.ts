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
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

type MenuRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: MenuRouteContext) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Approve menus from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request, MENU_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateMutationResponse(problemResponse(413, 'Request too large', error.message));
    }
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return privateMutationResponse(problemResponse(400, 'Invalid request', 'Provide a valid JSON body.'));
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
    return privateMutationResponse(NextResponse.json({ menu }));
  } catch (error) {
    if (error instanceof MenuNotFoundError) {
      return privateMutationResponse(problemResponse(404, 'Menu not found', 'The menu is unavailable.'));
    }
    if (error instanceof MenuConflictError) {
      return privateMutationResponse(problemResponse(409, 'Menu is not ready', error.message));
    }
    if (error instanceof MenuValidationError) {
      return privateMutationResponse(problemResponse(422, 'Invalid menu', error.message, {
        errors: error.errors,
      }));
    }
    if (error instanceof AuthorizationError) {
      return privateMutationResponse(problemResponse(403, 'Forbidden', 'You cannot approve this menu.'));
    }
    return privateMutationResponse(problemResponse(
      500,
      'Unable to approve menu',
      'The menu could not be approved. Try again.',
    ));
  }
}
