import type { Prisma, UserAccountState, UserRole } from '@prisma/client';

export type AuthorizationActor = {
  id: string;
  tenantId: string;
  role: UserRole;
  accountState?: UserAccountState;
  isActive: boolean;
};

export type OwnerCapability = 'award' | 'manage-members' | 'manage-settings';

const ownerCapabilities = new Set<OwnerCapability>([
  'award',
  'manage-members',
  'manage-settings',
]);

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
  readonly status = 403;

  constructor() {
    super('You do not have permission to perform this action.');
    this.name = 'AuthorizationError';
  }
}

export class LastActiveOwnerError extends Error {
  readonly code = 'LAST_ACTIVE_OWNER';
  readonly status = 409;

  constructor() {
    super('Add another active owner before deactivating this owner.');
    this.name = 'LastActiveOwnerError';
  }
}

export function requireOwner<T extends AuthorizationActor>(
  actor: T,
  capability: OwnerCapability,
) {
  if (
    !ownerCapabilities.has(capability) ||
    (actor.accountState !== undefined && actor.accountState !== 'ACTIVE') ||
    !actor.isActive ||
    actor.role !== 'OWNER'
  ) {
    throw new AuthorizationError();
  }
  return actor;
}

export async function assertCanDeactivateUser(
  transaction: Prisma.TransactionClient,
  actor: AuthorizationActor,
  targetUserId: string,
) {
  if (!targetUserId || targetUserId.length > 200) throw new AuthorizationError();

  await transaction.$queryRaw`
    SELECT "id"
    FROM "Tenant"
    WHERE "id" = ${actor.tenantId}
    FOR UPDATE
  `;
  const users = await transaction.$queryRaw<
    Array<{
      id: string;
      role: UserRole;
      accountState: UserAccountState;
      isActive: boolean;
    }>
  >`
    SELECT "id", "role", "accountState", "isActive"
    FROM "User"
    WHERE "tenantId" = ${actor.tenantId}
      AND (
        "id" = ${actor.id}
        OR "id" = ${targetUserId}
        OR (
          "role" = 'OWNER'
          AND "accountState" = 'ACTIVE'
          AND "isActive" = true
        )
      )
    ORDER BY "id"
    FOR UPDATE
  `;
  const currentActor = users.find(({ id }) => id === actor.id);
  if (!currentActor) throw new AuthorizationError();
  requireOwner(
    { ...currentActor, tenantId: actor.tenantId },
    'manage-members',
  );
  const target = users.find(({ id }) => id === targetUserId);
  if (!target || target.accountState !== 'ACTIVE') {
    throw new AuthorizationError();
  }

  if (
    target.isActive &&
    target.role === 'OWNER' &&
    users.filter(
      ({ role, accountState, isActive }) =>
        role === 'OWNER' && accountState === 'ACTIVE' && isActive,
    ).length <= 1
  ) {
    throw new LastActiveOwnerError();
  }

  return target;
}
