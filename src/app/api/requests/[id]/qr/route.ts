import { privateNoStoreResponse } from '@/lib/api/private-response';
import { resolveSiteMetadataUrls } from '@/config/site-url';
import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import {
  exportErrorResponse,
  exportResponse,
  runExportWithTimeout,
  unauthorizedExportResponse,
} from '@/lib/exports/export-http';
import { exportOperations, QR_BODY_BYTES } from '@/lib/exports/export-service';
import { requireAccountContext } from '@/lib/server-account';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';

type QrRouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 10;

function qrMutationError(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (!rejected) return null;
  return privateNoStoreResponse(
    rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Open QuotePlate on its original page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'),
  );
}

function qrBody(value: unknown) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'url')
  ) {
    throw new ExportBodyError();
  }
  return (value as { url: unknown }).url;
}

class ExportBodyError extends Error {}

function canonicalSupplierLinkOrigin() {
  return resolveSiteMetadataUrls().metadataBase.origin;
}

export async function POST(request: Request, context: QrRouteContext) {
  const rejected = qrMutationError(request);
  if (rejected) return rejected;
  const account = await requireAccountContext();
  if (!account) return unauthorizedExportResponse();
  try {
    const body = await readBoundedJson(request, QR_BODY_BYTES);
    const url = qrBody(body);
    const { id } = await context.params;
    const output = await runExportWithTimeout(exportOperations.qr({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      requestId: id,
      expectedOrigin: canonicalSupplierLinkOrigin(),
      url,
    }));
    return exportResponse(output);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return privateNoStoreResponse(problemResponse(413, 'Request too large', error.message));
    }
    if (error instanceof InvalidJsonBodyError) {
      return privateNoStoreResponse(problemResponse(400, 'Invalid request', error.message));
    }
    if (error instanceof ExportBodyError) {
      return privateNoStoreResponse(problemResponse(
        422,
        'Invalid QR request',
        'Provide only the supplier quote URL.',
      ));
    }
    return exportErrorResponse(error);
  }
}
