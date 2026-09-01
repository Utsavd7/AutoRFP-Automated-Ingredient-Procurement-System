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
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

export async function POST(req: Request) {
  const rejected = browserJsonMutationRejection(req);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Create menu drafts from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }

  let body: unknown;
  try {
    body = await readBoundedJson(req, MENU_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateMutationResponse(problemResponse(413, 'Request too large', error.message));
    }
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return privateMutationResponse(problemResponse(400, 'Invalid request', 'Provide a valid JSON body.'));
  }

  const input = parseMenuInput(body);
  if (!input.ok) {
    return privateMutationResponse(problemResponse(
      422,
      'Invalid request',
      'Paste a bounded menu as plain text.',
      { errors: input.errors },
    ));
  }

  const { menuText, source } = input.value;

  try {
    const menu = await createDeterministicMenuDraft({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      name: 'Menu draft',
      menuText,
      ...(source ? { source } : {}),
    });

    return privateMutationResponse(NextResponse.json({ menuId: menu.id }));
  } catch (error) {
    if (error instanceof MenuValidationError) {
      return privateMutationResponse(problemResponse(422, 'Invalid menu', error.message, {
        errors: error.errors,
      }));
    }
    return privateMutationResponse(problemResponse(
      500,
      'Unable to save menu',
      'The menu draft could not be saved. Try again.',
    ));
  }
}
