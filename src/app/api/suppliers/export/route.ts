import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
import { serializeSuppliersCsv } from '@/lib/suppliers/csv';
import {
  privateSupplierResponse,
  supplierActor,
  supplierError,
} from '@/lib/suppliers/supplier-http';
import { listSuppliersForExport } from '@/lib/suppliers/supplier-service';

export async function GET(request: Request) {
  const account = await requireAccountContext();
  if (!account) {
    return privateSupplierResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const url = new URL(request.url);
  try {
    const result = await listSuppliersForExport({
      actor: supplierActor(account),
      active: url.searchParams.get('active') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });
    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment; filename="quoteplate-suppliers.csv"',
      'Content-Type': 'text/csv; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    if (result.nextCursor) headers.set('X-Next-Cursor', result.nextCursor);
    return new Response(serializeSuppliersCsv(result.suppliers), { headers });
  } catch (error) {
    return supplierError(error);
  }
}
