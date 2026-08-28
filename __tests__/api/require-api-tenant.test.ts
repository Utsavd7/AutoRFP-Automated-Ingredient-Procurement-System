import { requireTenant } from '@/lib/server-account';
import { requireApiTenant } from '@/lib/api/require-api-tenant';

jest.mock('@/lib/server-account', () => ({
  requireTenant: jest.fn(),
}));

const requireTenantMock = jest.mocked(requireTenant);

describe('requireApiTenant', () => {
  beforeEach(() => {
    requireTenantMock.mockReset();
  });

  it('returns the authenticated tenant without a response', async () => {
    const tenant = {
      id: 'tenant_123',
    } as NonNullable<Awaited<ReturnType<typeof requireTenant>>>;
    requireTenantMock.mockResolvedValue(tenant);

    await expect(requireApiTenant()).resolves.toEqual({
      tenant,
      response: null,
    });
    expect(requireTenantMock).toHaveBeenCalledTimes(1);
  });

  it('returns a generic problem response when no tenant is authenticated', async () => {
    requireTenantMock.mockResolvedValue(null);

    const result = await requireApiTenant();

    expect(result.tenant).toBeNull();
    expect(result.response).not.toBeNull();
    expect(result.response?.status).toBe(401);
    expect(result.response?.headers.get('content-type')).toContain('application/problem+json');
    await expect(result.response?.json()).resolves.toEqual({
      type: 'about:blank',
      status: 401,
      title: 'Unauthorized',
      detail: 'Authentication is required.',
    });
  });
});
