import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
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
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (!mediaType || !csvMediaTypes.has(mediaType)) {
    return problemResponse(
      415,
      'Unsupported file type',
      'Upload a UTF-8 CSV file.',
    );
  }

  try {
    const csv = await readBoundedSupplierCsv(request);
    const rows = parseSupplierCsv(csv);
    const result = await importSupplierRows({
      actor: supplierActor(account),
      rows,
    });
    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return supplierError(error);
  }
}
