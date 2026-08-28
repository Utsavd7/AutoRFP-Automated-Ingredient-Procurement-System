import { randomUUID } from 'crypto';

import type { UserRole } from '@prisma/client';

import type { GoogleOnboarding } from '@/lib/auth/oauth-start';
import { prisma } from '@/lib/prisma';

export type GoogleIdentityUser = {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  userIsActive: boolean;
  tenantIsActive: boolean;
};

export type GoogleIdentityRepository = {
  findIdentity(
    provider: string,
    providerAccountId: string,
  ): Promise<GoogleIdentityUser | null>;
  findUserByEmail(email: string): Promise<GoogleIdentityUser | null>;
  createOwnerIdentity(
    input: GoogleOnboarding & {
      provider: string;
      providerAccountId: string;
    },
  ): Promise<GoogleIdentityUser>;
  touchLogin(userId: string): Promise<void>;
};

type GoogleIdentityErrorCode =
  | 'INVALID_GOOGLE_IDENTITY'
  | 'GOOGLE_EMAIL_UNVERIFIED'
  | 'GOOGLE_EMAIL_MISMATCH'
  | 'GOOGLE_ACCOUNT_NOT_REGISTERED'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'ACCOUNT_INACTIVE';

export class GoogleIdentityError extends Error {
  constructor(
    public readonly code: GoogleIdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleIdentityError';
  }
}

type GoogleAccount = {
  provider?: string | null;
  providerAccountId?: string | null;
};

type GoogleProfile = {
  sub?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
};

function active(user: GoogleIdentityUser) {
  if (!user.userIsActive || !user.tenantIsActive) {
    throw new GoogleIdentityError(
      'ACCOUNT_INACTIVE',
      'This account is not active.',
    );
  }
  return user;
}

function uniqueConflict(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002',
  );
}

export async function resolveGoogleIdentity(
  input: {
    account: GoogleAccount;
    profile: GoogleProfile;
    onboarding: GoogleOnboarding | null;
  },
  repository: GoogleIdentityRepository = prismaGoogleIdentityRepository,
) {
  const provider = input.account.provider;
  const providerAccountId = input.account.providerAccountId;
  const email = input.profile.email?.trim().toLowerCase();

  if (
    provider !== 'google' ||
    !providerAccountId ||
    (input.profile.sub && input.profile.sub !== providerAccountId)
  ) {
    throw new GoogleIdentityError(
      'INVALID_GOOGLE_IDENTITY',
      'Google did not return a valid account identity.',
    );
  }
  if (input.profile.email_verified !== true || !email) {
    throw new GoogleIdentityError(
      'GOOGLE_EMAIL_UNVERIFIED',
      'Use a Google account with a verified email address.',
    );
  }

  const existingIdentity = await repository.findIdentity(
    provider,
    providerAccountId,
  );
  if (existingIdentity) {
    const user = active(existingIdentity);
    await repository.touchLogin(user.userId);
    return user;
  }

  if (!input.onboarding) {
    throw new GoogleIdentityError(
      'GOOGLE_ACCOUNT_NOT_REGISTERED',
      'No workspace is connected to this Google account. Start a workspace first.',
    );
  }
  if (input.onboarding.email !== email) {
    throw new GoogleIdentityError(
      'GOOGLE_EMAIL_MISMATCH',
      'Continue with the same Google email used to start signup.',
    );
  }
  if (await repository.findUserByEmail(email)) {
    throw new GoogleIdentityError(
      'EMAIL_ALREADY_REGISTERED',
      'That email already has an account. Sign in with its existing method.',
    );
  }

  try {
    return active(
      await repository.createOwnerIdentity({
        ...input.onboarding,
        email,
        provider,
        providerAccountId,
      }),
    );
  } catch (error) {
    if (!uniqueConflict(error)) throw error;

    const racedIdentity = await repository.findIdentity(
      provider,
      providerAccountId,
    );
    if (racedIdentity) return active(racedIdentity);

    if (await repository.findUserByEmail(email)) {
      throw new GoogleIdentityError(
        'EMAIL_ALREADY_REGISTERED',
        'That email already has an account. Sign in with its existing method.',
      );
    }
    throw error;
  }
}

function identityUser(input: {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  tenant: { isActive: boolean };
}): GoogleIdentityUser {
  return {
    userId: input.id,
    tenantId: input.tenantId,
    name: input.name,
    email: input.email,
    role: input.role,
    userIsActive: input.isActive,
    tenantIsActive: input.tenant.isActive,
  };
}

export const prismaGoogleIdentityRepository: GoogleIdentityRepository = {
  async findIdentity(provider, providerAccountId) {
    const identity = await prisma.externalIdentity.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId },
      },
      include: { user: { include: { tenant: true } } },
    });
    return identity ? identityUser(identity.user) : null;
  },

  async findUserByEmail(email) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });
    return user ? identityUser(user) : null;
  },

  async createOwnerIdentity(input) {
    const tenantId = randomUUID();
    const userId = randomUUID();
    return prisma.$transaction(async (transaction) => {
      await transaction.tenant.create({
        data: {
          id: tenantId,
          name: input.restaurantName,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state,
          pin: input.pin,
          phone: input.phone,
          timezone: input.timezone,
          gstin: input.gstin,
        },
      });
      const user = await transaction.user.create({
        data: {
          id: userId,
          tenantId,
          name: input.ownerName,
          email: input.email,
          role: 'OWNER',
        },
        include: { tenant: true },
      });
      await transaction.externalIdentity.create({
        data: {
          tenantId,
          userId,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      });
      return identityUser(user);
    });
  },

  async touchLogin(userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  },
};
