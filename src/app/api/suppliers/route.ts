import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';
import {
  createSupplier,
  listSuppliers,
} from '@/lib/suppliers/supplier-service';
import {
  isProblemResponse,
  privateSupplierResponse,
  readSupplierJson,
  supplierActor,
  supplierError,
} from '@/lib/suppliers/supplier-http';

export async function GET(request: Request) {
  const account = await requireAccountContext();
  if (!account) {
    return privateSupplierResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const url = new URL(request.url);
  try {
    const result = await listSuppliers({
      actor: supplierActor(account),
      active: url.searchParams.get('active') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });
    return privateSupplierResponse(NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    }));
  } catch (error) {
    return supplierError(error);
  }
}

export async function POST(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Manage suppliers from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const supplier = await readSupplierJson(request);
  if (isProblemResponse(supplier)) return privateMutationResponse(supplier);
  try {
    const created = await createSupplier({
      actor: supplierActor(account),
      supplier,
    });
    return privateMutationResponse(NextResponse.json(
      { supplier: created },
      { status: 201 },
    ));
  } catch (error) {
    return privateMutationResponse(supplierError(error));
  }
}
