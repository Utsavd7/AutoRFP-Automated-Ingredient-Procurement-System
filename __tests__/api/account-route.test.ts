import { readFileSync } from 'node:fs';
import path from 'node:path';

import { GET } from '@/app/api/account/route';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({
  requireAccountContext: jest.fn(),
  tenantToAccount: jest.requireActual('@/lib/server-account').tenantToAccount,
}));

const currentTenant = {
  id: 'tenant-a', name: 'Monsoon Table', addressLine: '1 Market Road', city: 'Mumbai',
  state: 'Maharashtra', pin: '400001', phone: '9876543210', timezone: 'Asia/Kolkata',
  gstin: null, isActive: true, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};
const owner = {
  id: 'owner-a', tenantId: 'tenant-a', name: 'A Owner', email: 'owner-a@example.test',
  passwordHash: null, googleSubject: null, role: 'OWNER' as const,
  accountState: 'ACTIVE' as const, invitationTokenDigest: null,
  invitationExpiresAt: null, invitationAcceptedAt: null,
  invitationRevokedAt: null, invitedByUserId: null, tutorialVersion: 1,
  tutorialStep: 0, tutorialSkippedAt: null, tutorialCompletedAt: null,
  isActive: true,
  lastLoginAt: null, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'), tenant: currentTenant,
};

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('account read route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue({ tenant: currentTenant, user: owner });
  });

  it('returns the active shell account privately', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      account: {
        name: 'Monsoon Table',
        addressLine: '1 Market Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400001',
      },
      tutorial: {
        version: 1,
        step: 0,
        lastStep: 5,
        skippedAt: null,
        completedAt: null,
      },
    });
  });

  it('returns private unauthenticated and generic outage responses', async () => {
    jest.mocked(requireAccountContext).mockResolvedValueOnce(null);
    const unauthorized = await GET();
    jest.mocked(requireAccountContext).mockRejectedValueOnce(
      new Error('postgres password for tenant-secret'),
    );
    const unavailable = await GET();

    expect(unauthorized.status).toBe(401);
    expect(unavailable.status).toBe(503);
    expectPrivate(unauthorized);
    expectPrivate(unavailable);
    expect(await unavailable.text()).not.toMatch(/postgres|password|tenant-secret/i);
  });

  it('does not expose the obsolete account PUT mutation', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../src/app/api/account/route.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/export\s+async\s+function\s+PUT/);
    expect(source).not.toContain('updateWorkspaceAccount');
  });
});
