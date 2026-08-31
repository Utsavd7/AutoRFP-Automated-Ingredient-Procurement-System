import { NextResponse } from 'next/server';

import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';
import {
  isProblemResponse,
  readSupplierJson,
  supplierActor,
  supplierError,
} from '@/lib/suppliers/supplier-http';
import { validateSupplierVerificationDecision } from '@/lib/suppliers/supplier-schema';
import { decideSupplierVerification } from '@/lib/suppliers/supplier-service';

type SupplierRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: SupplierRouteContext) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Review suppliers from the QuotePlate workspace page.')
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
  const body = await readSupplierJson(request);
  if (isProblemResponse(body)) return privateMutationResponse(body);
  const { id } = await context.params;
  try {
    const decision = validateSupplierVerificationDecision(body);
    const supplier = await decideSupplierVerification({
      actor: supplierActor(account),
      supplierId: id,
      decision,
    });
    return privateMutationResponse(NextResponse.json({ supplier }));
  } catch (error) {
    return privateMutationResponse(supplierError(error));
  }
}
