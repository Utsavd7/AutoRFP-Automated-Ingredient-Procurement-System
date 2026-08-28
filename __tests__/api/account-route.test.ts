import { PUT } from '@/app/api/account/route';
import { requireAccountContext } from '@/lib/server-account';
import { updateWorkspaceAccount } from '@/lib/account/update-workspace';

jest.mock('@/lib/server-account', () => ({
  requireAccountContext: jest.fn(),
  tenantToAccount: jest.requireActual('@/lib/server-account').tenantToAccount,
}));

jest.mock('@/lib/account/update-workspace', () => ({
  updateWorkspaceAccount: jest.fn(),
}));

const currentTenant = {
  id: 'tenant-a',
  name: 'Old Kitchen',
  addressLine: '1 Old Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  pin: '400001',
  phone: '9000000001',
  timezone: 'Asia/Kolkata',
  gstin: null,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const owner = {
  id: 'owner-a',
  tenantId: 'tenant-a',
  name: 'A Owner',
  email: 'owner-a@example.test',
  passwordHash: null,
  legacyPasswordSalt: null,
  role: 'OWNER' as const,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  tenant: currentTenant,
};

const request = () =>
  new Request('http://localhost/api/account', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'New Kitchen',
      email: 'new-owner@example.test',
      addressLine: '2 New Road',
      city: 'Pune',
      state: 'Maharashtra',
      pin: '411001',
      phone: '9000000002',
    }),
  });

describe('account update route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue({
      tenant: currentTenant,
      user: owner,
    });
    jest.mocked(updateWorkspaceAccount).mockResolvedValue({
      tenant: {
        ...currentTenant,
        name: 'New Kitchen',
        addressLine: '2 New Road',
        city: 'Pune',
        pin: '411001',
        phone: '9000000002',
      },
      user: { ...owner, email: 'new-owner@example.test' },
    });
  });

  it('passes only the current database actor and validated account fields to the tenant service', async () => {
    const response = await PUT(request());

    expect(response.status).toBe(200);
    expect(updateWorkspaceAccount).toHaveBeenCalledWith({
      actor: { userId: 'owner-a', tenantId: 'tenant-a' },
      name: 'New Kitchen',
      email: 'new-owner@example.test',
      addressLine: '2 New Road',
      city: 'Pune',
      state: 'Maharashtra',
      pin: '411001',
      phone: '9000000002',
    });
    await expect(response.json()).resolves.toEqual({
      account: expect.objectContaining({
        tenantId: 'tenant-a',
        name: 'New Kitchen',
        email: 'new-owner@example.test',
      }),
    });
  });

  it('returns the existing forbidden response before parsing a member update', async () => {
    jest.mocked(requireAccountContext).mockResolvedValue({
      tenant: currentTenant,
      user: { ...owner, role: 'MEMBER' },
    });

    const response = await PUT(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(updateWorkspaceAccount).not.toHaveBeenCalled();
  });
});
