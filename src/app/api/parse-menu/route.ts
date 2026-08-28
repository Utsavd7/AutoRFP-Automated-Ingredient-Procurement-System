import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  MENU_REQUEST_BODY_BYTES,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import { parseMenuInput } from '@/lib/menu/menu-input';
import {
  createDeterministicMenuDraft,
  MenuValidationError,
} from '@/lib/menu/menu-service';
import { requireAccountContext } from '@/lib/server-account';

export async function POST(req: Request) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }

  let body: unknown;
  try {
    body = await readBoundedJson(req, MENU_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return problemResponse(413, 'Request too large', error.message);
    }
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return problemResponse(400, 'Invalid request', 'Provide a valid JSON body.');
  }

  const input = parseMenuInput(body);
  if (!input.ok) {
    return problemResponse(
      422,
      'Invalid request',
      'Paste a bounded menu as plain text.',
      { errors: input.errors },
    );
  }

  const { menuText } = input.value;

  try {
    const menu = await createDeterministicMenuDraft({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      name: 'Menu draft',
      menuText,
    });

    return NextResponse.json({
      success: true,
      menuId: menu.id,
      recipes: menu.recipes,
      modelSource: 'Deterministic review draft',
      requiresReview: true,
      menuInsight: null,
    });
  } catch (error) {
    if (error instanceof MenuValidationError) {
      return problemResponse(422, 'Invalid menu', error.message, {
        errors: error.errors,
      });
    }
    return problemResponse(
      500,
      'Unable to save menu',
      'The menu draft could not be saved. Try again.',
    );
  }
}
