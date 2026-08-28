import { Prisma, type PrismaClient } from '@prisma/client';

import { withTenant } from '@/lib/db/tenant-transaction';
import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { createPasswordRecord, verifyPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';

type CredentialsUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  passwordHash: string | null;
  legacyPasswordSalt: string | null;
  isActive: boolean;
  tenant: { isActive: boolean };
};

export type CredentialsRepository = {
  findByEmail(email: string): Promise<CredentialsUser | null>;
  recordSuccessfulLogin(
    tenantId: string,
    userId: string,
    passwordUpgrade: {
      passwordHash?: string;
      legacyPasswordSalt?: null;
    },
  ): Promise<void>;
};

export class CredentialsAuthError extends Error {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Email or password is incorrect.');
    this.name = 'CredentialsAuthError';
  }
}

export async function authenticateCredentials(
  credentials: { email?: string | null; password?: string | null },
  repository: CredentialsRepository = prismaCredentialsRepository,
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

  const user = await repository.findByEmail(email);
  if (
    !user ||
    !user.isActive ||
    !user.tenant.isActive ||
    !user.passwordHash
  ) {
    throw new CredentialsAuthError();
  }

  const verification = await verifyPassword(
    password,
    user.passwordHash,
    user.legacyPasswordSalt,
  );
  if (!verification.valid) throw new CredentialsAuthError();

  const passwordUpgrade = verification.needsUpgrade
    ? await createPasswordRecord(password)
    : {};
  await repository.recordSuccessfulLogin(
    user.tenantId,
    user.id,
    passwordUpgrade,
  );

  return {
    id: user.id,
    userId: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
  };
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
            legacyPasswordSalt: user.legacyPasswordSalt,
            isActive: user.userIsActive,
            tenant: { isActive: user.tenantIsActive },
          }
        : null;
    },

    async recordSuccessfulLogin(tenantId, userId, passwordUpgrade) {
      await withTenant(
        tenantId,
        (transaction) =>
          transaction.user.update({
            where: { id: userId },
            data: {
              lastLoginAt: new Date(),
              ...passwordUpgrade,
            },
          }).then(() => undefined),
        client,
      );
    },
  };
}

export const prismaCredentialsRepository =
  createPrismaCredentialsRepository(prisma);
