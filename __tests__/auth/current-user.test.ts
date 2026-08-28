import { loadCurrentUser } from '@/lib/auth/current-user';

describe('current authorization', () => {
  it('reloads the current role and active flags instead of trusting JWT claims', async () => {
    const findCurrent = jest.fn().mockResolvedValue({
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
      { findCurrent },
    );

    expect(current?.role).toBe('MEMBER');
    expect(findCurrent).toHaveBeenCalledWith('user-1', 'tenant-1');
  });

  it('rejects missing identifiers and inactive database records', async () => {
    const findCurrent = jest.fn().mockResolvedValue(null);
    const store = { findCurrent };

    await expect(loadCurrentUser({}, store)).resolves.toBeNull();
    await expect(
      loadCurrentUser({ userId: 'user-1', tenantId: 'tenant-1' }, store),
    ).resolves.toBeNull();
    expect(findCurrent).toHaveBeenCalledTimes(1);
  });
});
