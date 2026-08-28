import {
  exportErrorResponse,
  exportResponse,
  runExportWithTimeout,
  unauthorizedExportResponse,
} from '@/lib/exports/export-http';
import { exportOperations } from '@/lib/exports/export-service';
import { requireAccountContext } from '@/lib/server-account';

type PurchaseOrderRouteContext = {
  params: Promise<{ id: string; supplierId: string }>;
};

export const maxDuration = 10;

export async function GET(_request: Request, context: PurchaseOrderRouteContext) {
  const account = await requireAccountContext();
  if (!account) return unauthorizedExportResponse();
  const { id, supplierId } = await context.params;
  try {
    const output = await runExportWithTimeout(exportOperations.purchaseOrder({
      actor: { tenantId: account.tenant.id, userId: account.user.id },
      awardId: id,
      supplierId,
    }));
    return exportResponse(output);
  } catch (error) {
    return exportErrorResponse(error);
  }
}
