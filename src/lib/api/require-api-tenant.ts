import { problemResponse } from '@/lib/api/problem';
import { requireTenant } from '@/lib/server-account';

export async function requireApiTenant() {
  const tenant = await requireTenant();

  if (tenant) {
    return { tenant, response: null } as const;
  }

  return {
    tenant: null,
    response: problemResponse(401, 'Unauthorized', 'Authentication is required.'),
  } as const;
}
