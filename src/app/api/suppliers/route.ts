import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
import {
  createSupplier,
  listSuppliers,
} from '@/lib/suppliers/supplier-service';
import {
  isProblemResponse,
  readSupplierJson,
  supplierActor,
  supplierError,
} from '@/lib/suppliers/supplier-http';

export async function GET(request: Request) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
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
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return supplierError(error);
  }
}

export async function POST(request: Request) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }
  const supplier = await readSupplierJson(request);
  if (isProblemResponse(supplier)) return supplier;
  try {
    const created = await createSupplier({
      actor: supplierActor(account),
      supplier,
    });
    return NextResponse.json(
      { supplier: created },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return supplierError(error);
  }
}
