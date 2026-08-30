import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  ExportConflictError,
  ExportTimeoutError,
  MAX_EXPORT_BYTES,
  ExportNotFoundError,
  type ExportOutput,
  ExportTooLargeError,
  ExportValidationError,
} from '@/lib/exports/export-service';

export const EXPORT_TIMEOUT_MS = 8_000;

export function runExportWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs = EXPORT_TIMEOUT_MS,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs >= 10_000) {
    throw new TypeError('Export timeout must be between 1 and 9,999 milliseconds.');
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ExportTimeoutError());
    }, timeoutMs);
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const withExportPrivacy = privateNoStoreResponse;

export function exportResponse(output: ExportOutput) {
  if (output.bytes.byteLength < 1 || output.bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new ExportTooLargeError();
  }
  if (!/^[a-z0-9][a-z0-9.-]{0,180}$/.test(output.filename)) {
    throw new TypeError('Export filename is unsafe.');
  }
  return withExportPrivacy(new Response(Uint8Array.from(output.bytes).buffer, {
    headers: {
      'Content-Type': output.mediaType,
      'Content-Disposition': `attachment; filename="${output.filename}"`,
    },
  }));
}

export function exportErrorResponse(error: unknown) {
  if (error instanceof ExportNotFoundError) {
    return withExportPrivacy(problemResponse(
      404,
      'Export unavailable',
      'The requested record is unavailable.',
    ));
  }
  if (error instanceof ExportConflictError) {
    return withExportPrivacy(problemResponse(409, 'Export unavailable', error.message));
  }
  if (error instanceof ExportValidationError) {
    return withExportPrivacy(problemResponse(422, 'Invalid export', error.message));
  }
  if (error instanceof ExportTooLargeError) {
    return withExportPrivacy(problemResponse(413, 'Export too large', error.message));
  }
  if (error instanceof ExportTimeoutError) {
    return withExportPrivacy(problemResponse(503, 'Export timed out', error.message));
  }
  if (error instanceof AuthorizationError) {
    return withExportPrivacy(problemResponse(
      403,
      'Forbidden',
      'An active workspace member is required.',
    ));
  }
  return withExportPrivacy(problemResponse(
    503,
    'Export unavailable',
    'Unable to generate this export right now. Try again shortly.',
  ));
}

export function unauthorizedExportResponse() {
  return withExportPrivacy(
    problemResponse(401, 'Unauthorized', 'Authentication is required.'),
  );
}
