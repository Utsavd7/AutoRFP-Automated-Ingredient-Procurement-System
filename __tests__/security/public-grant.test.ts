import {
  PublicSupplierGrantError,
  exchangeSupplierGrantToken,
} from '@/lib/security/public-grant';
import { digestOpaqueToken } from '@/lib/security/tokens';

const now = new Date('2026-08-28T10:00:00.000Z');
const token = 'A'.repeat(43);

describe('public supplier grants', () => {
  it('resolves first, then rate-limits the resolved grant identity', async () => {
    const repository = {
      consumeAttempt: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 900,
      }),
      resolve: jest.fn().mockResolvedValue({
        tenantId: 'tenant-a',
        supplierRequestId: 'supplier-request-a',
      }),
    };

    await expect(
      exchangeSupplierGrantToken({ token, now }, repository),
    ).resolves.toEqual({
      tenantId: 'tenant-a',
      supplierRequestId: 'supplier-request-a',
    });
    const tokenDigest = digestOpaqueToken('supplier-request', token);
    expect(repository.resolve).toHaveBeenCalledWith({ tokenDigest });
    expect(repository.consumeAttempt).toHaveBeenCalledWith({
      supplierRequestId: 'supplier-request-a',
      now,
    });
    expect(repository.resolve.mock.invocationCallOrder[0]).toBeLessThan(
      repository.consumeAttempt.mock.invocationCallOrder[0]!,
    );
  });

  it('uses one unavailable response for malformed, expired, revoked, and unknown grants', async () => {
    const repository = {
      consumeAttempt: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 900,
      }),
      resolve: jest.fn().mockResolvedValue(null),
    };

    for (const candidate of ['', 'not-a-token', 'A'.repeat(42), 'A'.repeat(44)]) {
      await expect(
        exchangeSupplierGrantToken({ token: candidate, now }, repository),
      ).rejects.toMatchObject({
        code: 'GRANT_UNAVAILABLE',
        status: 410,
      });
    }
    await expect(
      exchangeSupplierGrantToken({ token, now }, repository),
    ).rejects.toMatchObject({ code: 'GRANT_UNAVAILABLE', status: 410 });
    expect(repository.consumeAttempt).not.toHaveBeenCalled();
  });

  it('returns a bounded retry response without resolving after the limit', async () => {
    const repository = {
      consumeAttempt: jest.fn().mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 321,
      }),
      resolve: jest.fn().mockResolvedValue({
        tenantId: 'tenant-a',
        supplierRequestId: 'supplier-request-a',
      }),
    };

    await expect(
      exchangeSupplierGrantToken({ token, now }, repository),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PublicSupplierGrantError>>({
        code: 'RATE_LIMITED',
        status: 429,
        retryAfterSeconds: 321,
      }),
    );
    expect(repository.resolve).toHaveBeenCalledWith({
      tokenDigest: digestOpaqueToken('supplier-request', token),
    });
    expect(repository.consumeAttempt).toHaveBeenCalledWith({
      supplierRequestId: 'supplier-request-a',
      now,
    });
  });
});
