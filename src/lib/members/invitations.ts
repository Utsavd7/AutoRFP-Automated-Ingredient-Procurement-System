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

export type InvitationActor = {
  userId: string;
  tenantId: string;
};

type InvitationClient = Pick<PrismaClient, '$queryRaw' | '$transaction'> &
  TenantTransactionHost;

type LockedActor = {
  id: string;
  tenantId: string;
  role: UserRole;
  isActive: boolean;
};

type LockedInvitation = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

function forbidden(): never {
  throw new InvitationError('FORBIDDEN', 403, 'Forbidden.');
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
    create(input) {
      return withTenant(
        input.actor.tenantId,
        async (transaction) => {
          const actor = await lockOwner(transaction, input.actor);
          const [existingAccount] = await transaction.$queryRaw<
            Array<{ exists: boolean }>
          >`
            SELECT autorfp_private.autorfp_user_email_exists(${input.email})
              AS "exists"
          `;
          if (existingAccount?.exists) {
            throw new InvitationError(
              'EMAIL_UNAVAILABLE',
              409,
              'This email cannot be invited.',
            );
          }
          const replaced = await transaction.invitation.findMany({
            where: {
              tenantId: actor.tenantId,
              email: input.email,
              acceptedAt: null,
              revokedAt: null,
            },
            select: { id: true },
          });
          await transaction.invitation.updateMany({
            where: {
              tenantId: actor.tenantId,
              email: input.email,
              acceptedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: input.now },
          });
          for (const previous of replaced) {
            await writeAuditEvent(transaction, {
              tenantId: actor.tenantId,
              actorUserId: actor.id,
              action: 'member.invitation-revoked',
              entityId: previous.id,
            });
          }
          const invitation = await transaction.invitation.create({
            data: {
              tenantId: actor.tenantId,
              email: input.email,
              role: input.role,
              tokenDigest: input.tokenDigest,
              expiresAt: input.expiresAt,
              invitedByUserId: actor.id,
            },
            select: { id: true },
          });
          await writeAuditEvent(transaction, {
            tenantId: actor.tenantId,
            actorUserId: actor.id,
            action: 'member.invited',
            entityId: invitation.id,
            metadata: { role: input.role },
          });
          return invitation;
        },
        client,
      );
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

            const [invitation] = await transaction.$queryRaw<LockedInvitation[]>`
              SELECT
                "id", "tenantId", "email", "role", "expiresAt",
                "acceptedAt", "revokedAt"
              FROM "Invitation"
              WHERE "tenantId" = ${input.tenantId}
                AND "tokenDigest" = ${input.tokenDigest}::CHAR(64)
                AND "expiresAt" > statement_timestamp()
              FOR UPDATE
            `;
            if (
              !invitation ||
              invitation.email !== input.email ||
              invitation.acceptedAt !== null ||
              invitation.revokedAt !== null
            ) {
              return null;
            }

            const [consumed] = await transaction.$queryRaw<
              Array<{ acceptedAt: Date }>
            >`
              UPDATE "Invitation"
              SET "acceptedAt" = statement_timestamp()
              WHERE "id" = ${invitation.id}
                AND "acceptedAt" IS NULL
                AND "revokedAt" IS NULL
                AND "expiresAt" > statement_timestamp()
              RETURNING "acceptedAt"
            `;
            if (!consumed) return null;

            const user = await transaction.user.create({
              data: {
                tenantId: invitation.tenantId,
                name: input.name,
                email: input.email,
                passwordHash: input.passwordHash,
                legacyPasswordSalt: null,
                role: invitation.role,
              },
              select: { id: true, tenantId: true },
            });
            await writeAuditEvent(transaction, {
              tenantId: invitation.tenantId,
              actorUserId: user.id,
              action: 'member.joined',
              entityId: user.id,
              metadata: { role: invitation.role },
            });
            return { userId: user.id, tenantId: user.tenantId };
          },
          client,
        );
      } catch (error) {
        if (userEmailUniqueConflict(error)) {
          throw new InvitationError(
            'EMAIL_UNAVAILABLE',
            409,
            'This email cannot join another workspace.',
          );
        }
        throw error;
      }
    },

    revoke(input) {
      return withTenant(
        input.actor.tenantId,
        async (transaction) => {
          const actor = await lockOwner(transaction, input.actor);
          const [invitation] = await transaction.$queryRaw<LockedInvitation[]>`
            SELECT
              "id", "tenantId", "email", "role", "expiresAt",
              "acceptedAt", "revokedAt"
            FROM "Invitation"
            WHERE "id" = ${input.invitationId}
              AND "tenantId" = ${actor.tenantId}
            FOR UPDATE
          `;
          if (
            !invitation ||
            invitation.acceptedAt !== null ||
            invitation.revokedAt !== null
          ) {
            unavailable();
          }
          await transaction.invitation.update({
            where: { id: invitation.id },
            data: { revokedAt: input.now },
          });
          await writeAuditEvent(transaction, {
            tenantId: actor.tenantId,
            actorUserId: actor.id,
            action: 'member.invitation-revoked',
            entityId: invitation.id,
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
  const invitation = await repository.create({
    actor: input.actor,
    email,
    role,
    tokenDigest: token.digest,
    expiresAt,
    now,
  });

  return {
    id: invitation.id,
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
