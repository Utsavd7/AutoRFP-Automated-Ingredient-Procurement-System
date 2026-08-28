import { loadCurrentUser } from '@/lib/auth/current-user';

describe('current authorization', () => {
  it('reloads the current role and active flags instead of trusting JWT claims', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      name: 'Asha',
      email: 'asha@example.com',
      role: 'MEMBER',
      isActive: true,
      tenant: { id: 'tenant-1', name: 'Tamarind', isActive: true },
    });

    const current = await loadCurrentUser(
      { userId: 'user-1', tenantId: 'tenant-1', role: 'OWNER' } as {
        userId: string;
        tenantId: string;
        role: string;
      },
      { user: { findFirst } },
    );

    expect(current?.role).toBe('MEMBER');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'user-1',
          tenantId: 'tenant-1',
          isActive: true,
          tenant: { isActive: true },
        },
      }),
    );
  });

  it('rejects missing identifiers and inactive database records', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const store = { user: { findFirst } };

    await expect(loadCurrentUser({}, store)).resolves.toBeNull();
    await expect(
      loadCurrentUser({ userId: 'user-1', tenantId: 'tenant-1' }, store),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
