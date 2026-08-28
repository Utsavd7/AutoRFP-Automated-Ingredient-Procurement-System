import { problemResponse } from '@/lib/api/problem';
import {
  InvalidJsonBodyError,
  readBoundedJson,
  RequestBodyTooLargeError,
} from '@/lib/api/read-bounded-json';
import { AuthorizationError } from '@/lib/auth/guards';
import type { requireAccountContext } from '@/lib/server-account';
import { SupplierCsvError } from '@/lib/suppliers/csv';
import {
  SupplierConflictError,
  SupplierNotFoundError,
} from '@/lib/suppliers/supplier-service';
import { SupplierValidationError } from '@/lib/suppliers/supplier-schema';

export const SUPPLIER_REQUEST_BODY_BYTES = 64 * 1_024;

type AccountContext = NonNullable<
  Awaited<ReturnType<typeof requireAccountContext>>
>;

export function supplierActor(context: AccountContext) {
  return { tenantId: context.tenant.id, userId: context.user.id };
}

export async function readSupplierJson(request: Request) {
  try {
    return await readBoundedJson(request, SUPPLIER_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return problemResponse(413, 'Request too large', error.message);
    }
    if (error instanceof InvalidJsonBodyError) {
      return problemResponse(400, 'Invalid request', error.message);
    }
    throw error;
  }
}

export function isProblemResponse(value: unknown): value is Response {
  return value instanceof Response;
}

export function supplierError(error: unknown): Response {
  if (error instanceof SupplierNotFoundError) {
    return problemResponse(404, 'Supplier not found', 'The supplier is unavailable.');
  }
  if (error instanceof SupplierValidationError) {
    return problemResponse(422, 'Invalid supplier', error.message, {
      errors: error.errors,
    });
  }
  if (error instanceof SupplierConflictError) {
    return problemResponse(409, 'Supplier already exists', error.message, {
      errors: error.errors,
    });
  }
  if (error instanceof SupplierCsvError) {
    return problemResponse(
      error.status,
      error.status === 413 ? 'Supplier CSV too large' : 'Invalid supplier CSV',
      error.message,
      { errorCount: error.errorCount, errors: error.errors },
    );
  }
  if (error instanceof AuthorizationError) {
    return problemResponse(403, 'Forbidden', 'You cannot access this supplier.');
  }
  throw error;
}
