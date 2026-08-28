import { Prisma, type PrismaClient } from '@prisma/client';

type RuntimeRoleClient = Pick<PrismaClient, '$queryRaw'>;

type RuntimeRoleRow = {
  currentUser: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
};

const assertions = new WeakMap<object, Promise<void>>();

export class RuntimeDatabaseRoleError extends Error {
  readonly code = 'UNSAFE_DATABASE_ROLE';

  constructor() {
    super('The application database connection is not using its restricted role.');
    this.name = 'RuntimeDatabaseRoleError';
  }
}

export function assertRuntimeDatabaseRole(client: RuntimeRoleClient) {
  const cached = assertions.get(client);
  if (cached) return cached;

  const assertion = (async () => {
    const [role] = await client.$queryRaw<RuntimeRoleRow[]>(Prisma.sql`
      SELECT
        current_user::TEXT AS "currentUser",
        role.rolsuper,
        role.rolbypassrls
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user
    `);
    if (
      !role ||
      role.currentUser !== 'autorfp_app' ||
      role.rolsuper ||
      role.rolbypassrls
    ) {
      throw new RuntimeDatabaseRoleError();
    }
  })();

  assertions.set(client, assertion);
  return assertion;
}
