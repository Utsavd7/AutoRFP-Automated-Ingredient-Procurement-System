import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
import {
  deactivateSupplier,
  getSupplier,
  updateSupplier,
} from '@/lib/suppliers/supplier-service';
import {
  isProblemResponse,
  readSupplierJson,
  supplierActor,
  supplierError,
} from '@/lib/suppliers/supplier-http';

type SupplierRouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: SupplierRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }
  const { id } = await context.params;
  try {
    const supplier = await getSupplier({
      actor: supplierActor(account),
      supplierId: id,
    });
    return NextResponse.json(
      { supplier },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return supplierError(error);
  }
}

export async function PUT(request: Request, context: SupplierRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }
  const changes = await readSupplierJson(request);
  if (isProblemResponse(changes)) return changes;
  const { id } = await context.params;
  try {
    const supplier = await updateSupplier({
      actor: supplierActor(account),
      supplierId: id,
      changes,
    });
    return NextResponse.json(
      { supplier },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return supplierError(error);
  }
}

export async function DELETE(_request: Request, context: SupplierRouteContext) {
  const account = await requireAccountContext();
  if (!account) {
    return problemResponse(401, 'Unauthorized', 'Authentication is required.');
  }
  const { id } = await context.params;
  try {
    const supplier = await deactivateSupplier({
      actor: supplierActor(account),
      supplierId: id,
    });
    return NextResponse.json(
      { supplier },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return supplierError(error);
  }
}
