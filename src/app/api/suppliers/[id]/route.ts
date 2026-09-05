import { NextResponse } from 'next/server';

import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  browserMutationOriginRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';
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
    return privateNoStoreResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const { id } = await context.params;
  try {
    const supplier = await getSupplier({
      actor: supplierActor(account),
      supplierId: id,
    });
    return privateNoStoreResponse(NextResponse.json(
      { supplier },
      { headers: { 'Cache-Control': 'private, no-store' } },
    ));
  } catch (error) {
    return supplierError(error);
  }
}

export async function PUT(request: Request, context: SupplierRouteContext) {
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
  const changes = await readSupplierJson(request);
  if (isProblemResponse(changes)) return privateMutationResponse(changes);
  const { id } = await context.params;
  try {
    const supplier = await updateSupplier({
      actor: supplierActor(account),
      supplierId: id,
      changes,
    });
    return privateMutationResponse(NextResponse.json({ supplier }));
  } catch (error) {
    return privateMutationResponse(supplierError(error));
  }
}

export async function DELETE(request: Request, context: SupplierRouteContext) {
  const rejected = browserMutationOriginRejection(request);
  if (rejected) {
    return privateMutationResponse(problemResponse(
      403,
      'Request not allowed',
      'Manage suppliers from the QuotePlate workspace page.',
    ));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const { id } = await context.params;
  try {
    const supplier = await deactivateSupplier({
      actor: supplierActor(account),
      supplierId: id,
    });
    return privateMutationResponse(NextResponse.json({ supplier }));
  } catch (error) {
    return privateMutationResponse(supplierError(error));
  }
}
