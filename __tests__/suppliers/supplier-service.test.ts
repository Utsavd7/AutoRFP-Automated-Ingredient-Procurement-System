import { listSuppliers } from '@/lib/suppliers/supplier-service';
import { SupplierValidationError } from '@/lib/suppliers/supplier-schema';

describe('supplier list cursor validation', () => {
  it('rejects decoded cursor control characters before reaching PostgreSQL', async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        v: 1,
        snapshot: '2026-08-28T00:00:00.000Z',
        active: null,
        search: null,
        createdAt: '2026-08-27T00:00:00.000Z\u0000',
        id: 'supplier-a',
      }),
      'utf8',
    ).toString('base64url');
    const client = {
      $queryRaw: jest.fn(() => {
        throw new Error('Database must not be reached for a malformed cursor.');
      }),
      $transaction: jest.fn(),
    };

    await expect(
      listSuppliers(
        {
          actor: { tenantId: 'tenant-a', userId: 'member-a' },
          active: 'all',
          cursor,
        },
        client as never,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_SUPPLIER',
      status: 422,
      errors: { cursor: ['Cursor is invalid or expired.'] },
    } satisfies Partial<SupplierValidationError>);
    expect(client.$queryRaw).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
