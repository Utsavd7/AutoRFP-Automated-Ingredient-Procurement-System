import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import { createPasswordRecord } from '@/lib/password';
import { prisma } from '@/lib/prisma';

export type EmailSignupInput = {
  restaurantName?: string;
  ownerName?: string;
  email?: string;
  password?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pin?: string;
  phone?: string;
  timezone?: string;
  gstin?: string | null;
};

type OwnerWorkspaceRecord = {
  restaurantName: string;
  ownerName: string;
  email: string;
  passwordHash: string;
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  phone: string;
  timezone: string;
  gstin: string | null;
};

export type EmailSignupRepository = {
  createOwnerWorkspace(
    input: OwnerWorkspaceRecord,
  ): Promise<{ userId: string; tenantId: string }>;
};

type EmailSignupErrorCode =
  | 'INVALID_SIGNUP'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'SIGNUP_UNAVAILABLE';

export class EmailSignupError extends Error {
  constructor(
    public readonly code: EmailSignupErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'EmailSignupError';
  }
}

function invalid(message: string): never {
  throw new EmailSignupError('INVALID_SIGNUP', 400, message);
}

function text(value: string | undefined, label: string, maxLength: number) {
  const normalized = value?.trim();
  if (!normalized) invalid(`${label} is required.`);
  if (normalized.length > maxLength) invalid(`${label} is too long.`);
  return normalized;
}

function uniqueConflict(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002',
  );
}

export async function createEmailWorkspace(
  input: EmailSignupInput,
  repository: EmailSignupRepository = prismaEmailSignupRepository,
) {
  const email = text(input.email, 'Email', 320).toLowerCase();
  const password = input.password ?? '';
  const pin = text(input.pin, 'PIN', 6);
  const gstin = input.gstin?.trim().toUpperCase() || null;

  if (!/^\S+@\S+\.\S+$/.test(email)) invalid('Enter a valid work email.');
  if (password.length < 8) invalid('Password must be at least 8 characters.');
  if (password.length > 1_024) invalid('Password is too long.');
  if (!/^\d{6}$/.test(pin)) invalid('Enter a valid 6-digit PIN.');
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) {
    invalid('Enter a valid GSTIN or leave it blank.');
  }

  const normalized = {
    restaurantName: text(input.restaurantName, 'Restaurant name', 200),
    ownerName: text(input.ownerName, 'Owner name', 200),
    email,
    addressLine: text(input.addressLine, 'Address', 500),
    city: text(input.city, 'City', 120),
    state: text(input.state, 'State', 120),
    pin,
    phone: text(input.phone, 'Phone', 32),
    timezone: text(input.timezone || 'Asia/Kolkata', 'Timezone', 64),
    gstin,
  };
  const passwordRecord = await createPasswordRecord(password);
  try {
    return await repository.createOwnerWorkspace({
      ...normalized,
      passwordHash: passwordRecord.passwordHash,
    });
  } catch (error) {
    if (uniqueConflict(error)) {
      throw new EmailSignupError(
        'EMAIL_ALREADY_REGISTERED',
        409,
        'A workspace already exists for that email. Use Sign in instead.',
      );
    }
    if (error instanceof EmailSignupError) throw error;
    throw new EmailSignupError(
      'SIGNUP_UNAVAILABLE',
      503,
      'Unable to create the workspace right now. Try again shortly.',
    );
  }
}

type SignupClient = Pick<PrismaClient, '$queryRaw' | '$transaction'> &
  TenantTransactionHost;

export function createPrismaEmailSignupRepository(
  client: SignupClient,
): EmailSignupRepository {
  return {
    async createOwnerWorkspace(input) {
      const tenantId = randomUUID();
      const userId = randomUUID();
      return withTenant(
        tenantId,
        async (transaction) => {
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
          await transaction.user.create({
            data: {
              id: userId,
              tenantId,
              name: input.ownerName,
              email: input.email,
              passwordHash: input.passwordHash,
              role: 'OWNER',
            },
          });
          return { tenantId, userId };
        },
        client,
      );
    },
  };
}

export const prismaEmailSignupRepository =
  createPrismaEmailSignupRepository(prisma);
