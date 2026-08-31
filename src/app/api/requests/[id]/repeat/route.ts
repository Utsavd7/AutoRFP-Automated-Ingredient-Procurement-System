import { NextResponse } from 'next/server';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { readRequestBody, requestActor, requestServiceError } from '@/lib/procurement/request-http';
import { repeatProcurementRequest } from '@/lib/procurement/request-service';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { requireAccountContext } from '@/lib/server-account';

type RepeatRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RepeatRouteContext) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Run this request again from its original QuotePlate page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) return privateResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  const body = await readRequestBody(request);
  if (body instanceof Response) return privateResponse(body);
  const { id } = await context.params;
  try {
    const repeated = await repeatProcurementRequest({
      actor: requestActor(account),
      sourceRequestId: id,
      repeat: body,
    });
    return privateResponse(NextResponse.json({ request: repeated }, { status: 201 }));
  } catch (error) {
    return privateResponse(requestServiceError(error));
  }
}
