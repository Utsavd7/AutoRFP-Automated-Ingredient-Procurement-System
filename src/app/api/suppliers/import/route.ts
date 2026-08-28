import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserMutationOriginRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';
import {
  parseSupplierCsv,
  readBoundedSupplierCsv,
} from '@/lib/suppliers/csv';
import {
  supplierActor,
  supplierError,
} from '@/lib/suppliers/supplier-http';
import { importSupplierRows } from '@/lib/suppliers/supplier-service';

const csvMediaTypes = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
]);

export async function POST(request: Request) {
  const rejected = browserMutationOriginRejection(request);
  if (rejected) {
    return privateMutationResponse(problemResponse(
      403,
      'Request not allowed',
      'Import suppliers from the QuotePlate workspace page.',
    ));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (!mediaType || !csvMediaTypes.has(mediaType)) {
    return privateMutationResponse(problemResponse(
      415,
      'Unsupported file type',
      'Upload a UTF-8 CSV file.',
    ));
  }

  try {
    const csv = await readBoundedSupplierCsv(request);
    const rows = parseSupplierCsv(csv);
    const result = await importSupplierRows({
      actor: supplierActor(account),
      rows,
    });
    return privateMutationResponse(NextResponse.json(result, {
      status: 201,
    }));
  } catch (error) {
    return privateMutationResponse(supplierError(error));
  }
}
