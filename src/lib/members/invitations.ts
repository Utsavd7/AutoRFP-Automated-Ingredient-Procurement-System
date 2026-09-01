import { Prisma, type PrismaClient, type UserRole } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { AuthorizationError, requireOwner } from '@/lib/auth/guards';
import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import { createPasswordRecord } from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import {
  createOpaqueToken,
  digestOpaqueToken,
} from '@/lib/security/tokens';

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const ACCEPTANCE_ATTEMPT_LIMIT = 5;
const ACCEPTANCE_ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const unavailableMessage = 'This invitation is invalid or no longer available.';

type InvitationErrorCode =
  | 'EMAIL_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'INVALID_INVITATION'
  | 'INVITATION_UNAVAILABLE'
  | 'RATE_LIMITED';

export class InvitationError extends Error {
  constructor(
    public readonly code: InvitationErrorCode,
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'InvitationError';
  }
}

export type InvitationActor = {
  userId: string;
  tenantId: string;
};

type CreateRecord = {
  actor: InvitationActor;
  email: string;
  role: UserRole;
  tokenDigest: string;
  expiresAt: Date;
  now: Date;
};

type AcceptRecord = {
  tokenDigest: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
};

export type InvitationRepository = {
  create(input: CreateRecord): Promise<{ id: string }>;
  resolve(input: {
    tokenDigest: string;
  }): Promise<{ tenantId: string } | null>;
  consumeAcceptanceAttempt(input: {
    tokenDigest: string;
    now: Date;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  accept(
    input: AcceptRecord,
  ): Promise<{ userId: string; tenantId: string } | null>;
  revoke(input: {
    actor: InvitationActor;
    invitationId: string;
    now: Date;
  }): Promise<void>;
};

type InvitationClient = Pick<PrismaClient, '$queryRaw' | '$transaction'> &
  TenantTransactionHost;

type LockedActor = {
  id: string;
  tenantId: string;
  role: UserRole;
  isActive: boolean;
};

type LockedInvitedUser = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  invitationExpiresAt: Date | null;
  invitationAcceptedAt: Date | null;
  invitationRevokedAt: Date | null;
};

function forbidden(): never {
  throw new InvitationError('FORBIDDEN', 403, 'Forbidden.');
}

function emailUnavailable(message = 'This email cannot be invited.'): never {
  throw new InvitationError('EMAIL_UNAVAILABLE', 409, message);
}

async function lockOwner(
  transaction: Prisma.TransactionClient,
  actor: InvitationActor,
) {
  const [tenant] = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Tenant"
    WHERE "id" = ${actor.tenantId}
      AND "isActive" = true
    FOR UPDATE
  `;
  if (!tenant) forbidden();

  const [currentActor] = await transaction.$queryRaw<LockedActor[]>`
    SELECT "id", "tenantId", "role", "isActive"
    FROM "User"
    WHERE "id" = ${actor.userId}
      AND "tenantId" = ${actor.tenantId}
      AND "accountState" = 'ACTIVE'
      AND "isActive" = true
    FOR UPDATE
  `;
  if (!currentActor) forbidden();
  try {
    return requireOwner(currentActor, 'manage-members');
  } catch (error) {
    if (error instanceof AuthorizationError) forbidden();
    throw error;
  }
}

function uniqueConflict(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002',
  );
}

function userEmailUniqueConflict(error: unknown) {
  if (!uniqueConflict(error) || !error || typeof error !== 'object') return false;
  const metadata = 'meta' in error && error.meta && typeof error.meta === 'object'
    ? error.meta as Record<string, unknown>
    : {};
  const target = Array.isArray(metadata.target)
    ? metadata.target.map(String)
    : [String(metadata.target ?? '')];
  return (
    metadata.modelName === 'User' &&
      (metadata.target == null || target.includes('email'))
  ) || target.includes('User_email_key');
}

export function createPrismaInvitationRepository(
  client: InvitationClient,
): InvitationRepository {
  return {
    async create(input) {
      try {
        return await withTenant(
          input.actor.tenantId,
          async (transaction) => {
            const actor = await lockOwner(transaction, input.actor);
            const existing = await transaction.user.findFirst({
              where: { tenantId: actor.tenantId, email: input.email },
              select: {
                id: true,
                accountState: true,
                passwordHash: true,
                googleSubject: true,
                invitationAcceptedAt: true,
                invitationRevokedAt: true,
              },
            });

            let invited: { id: string };
            if (existing) {
              const reusable =
                existing.accountState !== 'ACTIVE' &&
                existing.passwordHash === null &&
                existing.googleSubject === null &&
                existing.invitationAcceptedAt === null;
              if (!reusable) emailUnavailable();
              if (
                existing.accountState === 'INVITED' &&
                existing.invitationRevokedAt === null
              ) {
                await writeAuditEvent(transaction, {
                  tenantId: actor.tenantId,
                  actorUserId: actor.id,
                  action: 'member.invitation-revoked',
                  entityId: existing.id,
                });
              }
              invited = await transaction.user.update({
                where: { id: existing.id },
                data: {
                  name: input.email,
                  role: input.role,
                  accountState: 'INVITED',
                  isActive: false,
                  invitationTokenDigest: input.tokenDigest,
                  invitationExpiresAt: input.expiresAt,
                  invitationAcceptedAt: null,
                  invitationRevokedAt: null,
                  invitedByUserId: actor.id,
                },
                select: { id: true },
              });
            } else {
              const [existingAccount] = await transaction.$queryRaw<
                Array<{ exists: boolean }>
              >`
                SELECT autorfp_private.autorfp_user_email_exists(${input.email})
                  AS "exists"
              `;
              if (existingAccount?.exists) emailUnavailable();
              invited = await transaction.user.create({
                data: {
                  tenantId: actor.tenantId,
                  name: input.email,
                  email: input.email,
                  role: input.role,
                  accountState: 'INVITED',
                  isActive: false,
                  invitationTokenDigest: input.tokenDigest,
                  invitationExpiresAt: input.expiresAt,
                  invitedByUserId: actor.id,
                },
                select: { id: true },
              });
            }

            await writeAuditEvent(transaction, {
              tenantId: actor.tenantId,
              actorUserId: actor.id,
              action: 'member.invited',
              entityId: invited.id,
              metadata: { role: input.role },
            });
            return invited;
          },
          client,
        );
      } catch (error) {
        if (userEmailUniqueConflict(error)) emailUnavailable();
        throw error;
      }
    },

    async resolve(input) {
      await assertRuntimeDatabaseRole(client);
      const [resolved] = await client.$queryRaw<Array<{ tenantId: string }>>(
        Prisma.sql`
          SELECT *
          FROM autorfp_private.autorfp_invitation_tenant_by_digest(
            ${input.tokenDigest}
          )
        `,
      );
      return resolved ?? null;
    },

    consumeAcceptanceAttempt(input) {
      return consumeDigestRateLimit(
        {
          scope: 'member-invitation-accept',
          subjectDigest: input.tokenDigest,
          limit: ACCEPTANCE_ATTEMPT_LIMIT,
          windowMs: ACCEPTANCE_ATTEMPT_WINDOW_MS,
          now: input.now,
        },
        client,
      );
    },

    async accept(input) {
      try {
        return await withTenant(
          input.tenantId,
          async (transaction) => {
            const [tenant] = await transaction.$queryRaw<Array<{ id: string }>>`
              SELECT "id"
              FROM "Tenant"
              WHERE "id" = ${input.tenantId}
                AND "isActive" = true
              FOR UPDATE
            `;
            if (!tenant) return null;

            const [invited] = await transaction.$queryRaw<LockedInvitedUser[]>`
              SELECT
                "id", "tenantId", "email", "role", "invitationExpiresAt",
                "invitationAcceptedAt", "invitationRevokedAt"
              FROM "User"
              WHERE "tenantId" = ${input.tenantId}
                AND "invitationTokenDigest" = ${input.tokenDigest}::CHAR(64)
                AND "accountState" = 'INVITED'
                AND "isActive" = false
                AND "invitationAcceptedAt" IS NULL
                AND "invitationRevokedAt" IS NULL
                AND "invitationExpiresAt" > statement_timestamp()
              FOR UPDATE
            `;
            if (!invited || invited.email !== input.email) return null;

            const [accepted] = await transaction.$queryRaw<
              Array<{ id: string; tenantId: string; role: UserRole }>
            >`
              UPDATE "User"
              SET
                "name" = ${input.name},
                "passwordHash" = ${input.passwordHash},
                "accountState" = 'ACTIVE',
                "isActive" = true,
                "invitationTokenDigest" = NULL,
                "invitationAcceptedAt" = statement_timestamp(),
                "updatedAt" = statement_timestamp()
              WHERE "id" = ${invited.id}
                AND "tenantId" = ${input.tenantId}
                AND "invitationTokenDigest" = ${input.tokenDigest}::CHAR(64)
                AND "accountState" = 'INVITED'
                AND "isActive" = false
                AND "invitationAcceptedAt" IS NULL
                AND "invitationRevokedAt" IS NULL
                AND "invitationExpiresAt" > statement_timestamp()
              RETURNING "id", "tenantId", "role"
            `;
            if (!accepted) return null;

            await writeAuditEvent(transaction, {
              tenantId: accepted.tenantId,
              actorUserId: accepted.id,
              action: 'member.joined',
              entityId: accepted.id,
              metadata: { role: accepted.role },
            });
            return { userId: accepted.id, tenantId: accepted.tenantId };
          },
          client,
        );
      } catch (error) {
        if (userEmailUniqueConflict(error)) {
          emailUnavailable('This email cannot join another workspace.');
        }
        throw error;
      }
    },

    revoke(input) {
      return withTenant(
        input.actor.tenantId,
        async (transaction) => {
          const actor = await lockOwner(transaction, input.actor);
          const [invited] = await transaction.$queryRaw<LockedInvitedUser[]>`
            SELECT
              "id", "tenantId", "email", "role", "invitationExpiresAt",
              "invitationAcceptedAt", "invitationRevokedAt"
            FROM "User"
            WHERE "id" = ${input.invitationId}
              AND "tenantId" = ${actor.tenantId}
              AND "accountState" = 'INVITED'
              AND "isActive" = false
            FOR UPDATE
          `;
          if (
            !invited ||
            invited.invitationAcceptedAt !== null ||
            invited.invitationRevokedAt !== null
          ) {
            unavailable();
          }
          await transaction.user.update({
            where: { id: invited.id },
            data: {
              accountState: 'DEACTIVATED',
              isActive: false,
              invitationTokenDigest: null,
              invitationRevokedAt: input.now,
            },
          });
          await writeAuditEvent(transaction, {
            tenantId: actor.tenantId,
            actorUserId: actor.id,
            action: 'member.invitation-revoked',
            entityId: invited.id,
          });
        },
        client,
      );
    },
  };
}

export const prismaInvitationRepository =
  createPrismaInvitationRepository(prisma);

function normalizedEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new InvitationError(
      'INVALID_INVITATION',
      400,
      'Enter a valid work email.',
    );
  }
  return email;
}

function unavailable(): never {
  throw new InvitationError('INVITATION_UNAVAILABLE', 410, unavailableMessage);
}

export async function createInvitation(
  input: {
    actor: InvitationActor;
    email: unknown;
    role?: unknown;
  },
  repository: InvitationRepository = prismaInvitationRepository,
  now = new Date(),
) {
  const email = normalizedEmail(input.email);
  const role = input.role ?? 'MEMBER';
  if (role !== 'MEMBER' && role !== 'OWNER') {
    throw new InvitationError(
      'INVALID_INVITATION',
      400,
      'Choose a valid workspace role.',
    );
  }

  const token = createOpaqueToken('member-invitation');
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
  const invited = await repository.create({
    actor: input.actor,
    email,
    role,
    tokenDigest: token.digest,
    expiresAt,
    now,
  });

  return {
    id: invited.id,
    token: token.raw,
    email,
    role,
    expiresAt,
  };
}

export async function acceptInvitation(
  input: {
    token: unknown;
    email: unknown;
    name: unknown;
    password: unknown;
  },
  repository: InvitationRepository = prismaInvitationRepository,
  now = new Date(),
) {
  let tokenDigest: string;
  try {
    tokenDigest = digestOpaqueToken(
      'member-invitation',
      typeof input.token === 'string' ? input.token : '',
    );
  } catch {
    unavailable();
  }

  const email = normalizedEmail(input.email);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!name || name.length > 200) {
    throw new InvitationError(
      'INVALID_INVITATION',
      400,
      'Your name is required.',
    );
  }
  if (password.length < 8 || password.length > 1_024) {
    throw new InvitationError(
      'INVALID_INVITATION',
      400,
      'Password must be between 8 and 1,024 characters.',
    );
  }

  const resolved = await repository.resolve({ tokenDigest });
  if (!resolved) unavailable();

  const rateLimit = await repository.consumeAcceptanceAttempt({
    tokenDigest,
    now,
  });
  if (!rateLimit.allowed) {
    throw new InvitationError(
      'RATE_LIMITED',
      429,
      'Too many attempts. Try again later.',
      rateLimit.retryAfterSeconds,
    );
  }

  const passwordRecord = await createPasswordRecord(password);
  const accepted = await repository.accept({
    tokenDigest,
    tenantId: resolved.tenantId,
    email,
    name,
    passwordHash: passwordRecord.passwordHash,
  });
  return accepted ?? unavailable();
}

export async function revokeInvitation(
  input: {
    actor: InvitationActor;
    invitationId: unknown;
  },
  repository: InvitationRepository = prismaInvitationRepository,
  now = new Date(),
) {
  const invitationId =
    typeof input.invitationId === 'string' ? input.invitationId.trim() : '';
  if (!invitationId || invitationId.length > 200) {
    throw new InvitationError(
      'INVALID_INVITATION',
      400,
      'A valid invitation is required.',
    );
  }
  await repository.revoke({ actor: input.actor, invitationId, now });
}
