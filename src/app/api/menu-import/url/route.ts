import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import {
  importPermittedMenuUrl,
  MENU_URL_IMPORT_BODY_BYTES,
  MenuUrlImportError,
} from '@/lib/menu/url-import';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

export async function POST(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Import a menu from its original QuotePlate page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(
      401,
      'Unauthorized',
      'Authentication is required.',
    ));
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, MENU_URL_IMPORT_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateMutationResponse(problemResponse(413, 'Request too large', error.message));
    }
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return privateMutationResponse(problemResponse(
      400,
      'Invalid request',
      'Provide a valid JSON body.',
    ));
  }
  try {
    const imported = await importPermittedMenuUrl(body);
    return privateMutationResponse(NextResponse.json(imported));
  } catch (error) {
    if (!(error instanceof MenuUrlImportError)) throw error;
    return privateMutationResponse(problemResponse(
      422,
      'Unable to import menu',
      error.message,
    ));
  }
}
