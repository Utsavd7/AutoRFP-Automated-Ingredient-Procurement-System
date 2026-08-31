import {
  Prisma,
  type PrismaClient,
  type UserAccountState,
} from '@prisma/client';

import { withTenant } from '@/lib/db/tenant-transaction';
import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { verifyPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { consumeCredentialsRateLimit } from '@/lib/auth/rate-limit';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$A2C1USZCjd21FkRlYzw8SA$Ke7S61hzrs03ukAWHgXXYspC3E485UyorKnlcBnp/mU';

type CredentialsUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  passwordHash: string | null;
  accountState: UserAccountState;
  isActive: boolean;
  tenant: { isActive: boolean };
};

export type CredentialsRepository = {
  findByEmail(email: string): Promise<CredentialsUser | null>;
  recordSuccessfulLogin(
    tenantId: string,
    userId: string,
  ): Promise<void>;
};

export class CredentialsAuthError extends Error {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Email or password is incorrect.');
    this.name = 'CredentialsAuthError';
  }
}

export class CredentialsUnavailableError extends Error {
  readonly code = 'AUTH_UNAVAILABLE';

  constructor() {
    super('Sign in is temporarily unavailable. Try again shortly.');
    this.name = 'CredentialsUnavailableError';
  }
}

type CredentialsDependencies = {
  clientIdentifier?: string | null;
  now?: Date;
  rateLimit?: typeof consumeCredentialsRateLimit;
  verifyPassword?: typeof verifyPassword;
};

export async function authenticateCredentials(
  credentials: { email?: string | null; password?: string | null },
  repository: CredentialsRepository = prismaCredentialsRepository,
  input: CredentialsDependencies = {},
) {
  const email = credentials.email?.trim().toLowerCase();
  const password = credentials.password ?? '';
  if (
    !email ||
    email.length > 320 ||
    !password ||
    password.length > 1_024
  ) {
    throw new CredentialsAuthError();
  }

  try {
    const rateLimit = await (input.rateLimit ?? consumeCredentialsRateLimit)({
      clientIdentifier: input.clientIdentifier,
      email,
      now: input.now ?? new Date(),
    });
    if (!rateLimit.allowed) throw new CredentialsAuthError();

    const user = await repository.findByEmail(email);
    const usableUser =
      user?.isActive &&
      user.accountState === 'ACTIVE' &&
      user.tenant.isActive &&
      user.passwordHash?.startsWith('$argon2id$')
        ? user
        : null;
    const valid = await (input.verifyPassword ?? verifyPassword)(
      password,
      usableUser?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!usableUser || !valid) throw new CredentialsAuthError();
    await repository.recordSuccessfulLogin(usableUser.tenantId, usableUser.id);

    return {
      id: usableUser.id,
      userId: usableUser.id,
      tenantId: usableUser.tenantId,
      name: usableUser.name,
      email: usableUser.email,
    };
  } catch (error) {
    if (error instanceof CredentialsAuthError) throw error;
    throw new CredentialsUnavailableError();
  }
}

type CredentialsClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

type CredentialsLookupRow = Omit<CredentialsUser, 'isActive' | 'tenant'> & {
  userIsActive: boolean;
  tenantIsActive: boolean;
};

export function createPrismaCredentialsRepository(
  client: CredentialsClient,
): CredentialsRepository {
  return {
    async findByEmail(email) {
      await assertRuntimeDatabaseRole(client);
      const [user] = await client.$queryRaw<CredentialsLookupRow[]>(Prisma.sql`
        SELECT *
        FROM autorfp_private.autorfp_auth_credentials_by_email(${email})
      `);
      return user
        ? {
            id: user.id,
            tenantId: user.tenantId,
            name: user.name,
            email: user.email,
            passwordHash: user.passwordHash,
            accountState: user.userIsActive ? 'ACTIVE' : 'DEACTIVATED',
            isActive: user.userIsActive,
            tenant: { isActive: user.tenantIsActive },
          }
        : null;
    },

    async recordSuccessfulLogin(tenantId, userId) {
      await withTenant(
        tenantId,
        (transaction) =>
          transaction.user.update({
            where: { id: userId },
            data: {
              lastLoginAt: new Date(),
            },
          }).then(() => undefined),
        client,
      );
    },
  };
}

export const prismaCredentialsRepository =
  createPrismaCredentialsRepository(prisma);
