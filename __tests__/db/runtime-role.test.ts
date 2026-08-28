import {
  assertRuntimeDatabaseRole,
  RuntimeDatabaseRoleError,
} from '@/lib/db/runtime-role';

function clientWithRole(input: {
  currentUser: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([input]),
  };
}

describe('runtime database role assertion', () => {
  it('accepts and caches only the exact non-bypass application role', async () => {
    const client = clientWithRole({
      currentUser: 'autorfp_app',
      rolsuper: false,
      rolbypassrls: false,
    });

    await expect(assertRuntimeDatabaseRole(client as never)).resolves.toBeUndefined();
    await expect(assertRuntimeDatabaseRole(client as never)).resolves.toBeUndefined();
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an administrator or bypass role', async () => {
    for (const role of [
      { currentUser: 'postgres', rolsuper: true, rolbypassrls: true },
      { currentUser: 'autorfp_app', rolsuper: false, rolbypassrls: true },
    ]) {
      const client = clientWithRole(role);
      await expect(
        assertRuntimeDatabaseRole(client as never),
      ).rejects.toMatchObject<Partial<RuntimeDatabaseRoleError>>({
        code: 'UNSAFE_DATABASE_ROLE',
      });
    }
  });
});
