import {
  exportErrorResponse,
  exportResponse,
  runExportWithTimeout,
  unauthorizedExportResponse,
} from '@/lib/exports/export-http';
import {
  exportOperations,
  type RequestExportKind,
} from '@/lib/exports/export-service';
import { requireAccountContext } from '@/lib/server-account';

type ExportRouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 10;

export async function GET(request: Request, context: ExportRouteContext) {
  const account = await requireAccountContext();
  if (!account) return unauthorizedExportResponse();
  const { id } = await context.params;
  const kind = new URL(request.url).searchParams.get('kind');
  try {
    const output = await runExportWithTimeout(exportOperations.requestCsv({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      requestId: id,
      kind: kind as RequestExportKind,
    }));
    return exportResponse(output);
  } catch (error) {
    return exportErrorResponse(error);
  }
}
