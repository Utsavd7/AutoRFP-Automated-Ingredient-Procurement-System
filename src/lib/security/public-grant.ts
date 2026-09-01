import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { prisma } from '@/lib/prisma';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import { digestOpaqueToken } from '@/lib/security/tokens';

const ACCESS_ATTEMPT_LIMIT = 10;
const ACCESS_ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const APPLICATION_ATTEMPT_LIMIT = 10;
const APPLICATION_ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const unavailableMessage =
  'This supplier link is invalid or no longer available.';

export type PublicSupplierGrant = {
  tenantId: string;
  supplierRequestId: string;
};

export type PublicSupplierApplicationGrant = {
  tenantId: string;
  requestId: string;
};

export class PublicSupplierGrantError extends Error {
  constructor(
    public readonly code: 'GRANT_UNAVAILABLE' | 'RATE_LIMITED',
    public readonly status: 410 | 429,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'PublicSupplierGrantError';
  }
}

export type PublicSupplierGrantRepository = {
  consumeAttempt(input: {
    supplierRequestId: string;
    now: Date;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  resolve(input: { tokenDigest: string }): Promise<PublicSupplierGrant | null>;
};

export type PublicSupplierApplicationGrantRepository = {
  consumeAttempt(input: {
    requestId: string;
    now: Date;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  resolve(input: {
    tokenDigest: string;
  }): Promise<PublicSupplierApplicationGrant | null>;
};

type PublicGrantClient = Pick<PrismaClient, '$queryRaw'>;

function supplierRequestRateLimitDigest(supplierRequestId: string) {
  return createHash('sha256')
    .update('quoteplate:v1:supplier-request-rate-limit:', 'utf8')
    .update(supplierRequestId, 'utf8')
    .digest('hex');
}

function supplierApplicationRateLimitDigest(requestId: string) {
  return createHash('sha256')
    .update('quoteplate:v1:supplier-application-rate-limit:', 'utf8')
    .update(requestId, 'utf8')
    .digest('hex');
}

export function createPrismaPublicSupplierGrantRepository(
  client: PublicGrantClient = prisma,
): PublicSupplierGrantRepository {
  return {
    consumeAttempt({ supplierRequestId, now }) {
      return consumeDigestRateLimit(
        {
          scope: 'supplier-request',
          subjectDigest: supplierRequestRateLimitDigest(supplierRequestId),
          limit: ACCESS_ATTEMPT_LIMIT,
          windowMs: ACCESS_ATTEMPT_WINDOW_MS,
          now,
        },
        client,
      );
    },
    async resolve({ tokenDigest }) {
      await assertRuntimeDatabaseRole(client);
      const [grant] = await client.$queryRaw<PublicSupplierGrant[]>(Prisma.sql`
        SELECT "tenantId", "supplierRequestId"
        FROM autorfp_private.autorfp_supplier_grant_by_digest(${tokenDigest})
      `);
      return grant ?? null;
    },
  };
}

export function createPrismaPublicSupplierApplicationGrantRepository(
  client: PublicGrantClient = prisma,
): PublicSupplierApplicationGrantRepository {
  return {
    consumeAttempt({ requestId, now }) {
      return consumeDigestRateLimit(
        {
          scope: 'supplier-application',
          subjectDigest: supplierApplicationRateLimitDigest(requestId),
          limit: APPLICATION_ATTEMPT_LIMIT,
          windowMs: APPLICATION_ATTEMPT_WINDOW_MS,
          now,
        },
        client,
      );
    },
    async resolve({ tokenDigest }) {
      await assertRuntimeDatabaseRole(client);
      const [grant] = await client.$queryRaw<PublicSupplierApplicationGrant[]>(
        Prisma.sql`
          SELECT "tenantId", "requestId"
          FROM autorfp_private.autorfp_supplier_application_grant_by_digest(
            ${tokenDigest}
          )
        `,
      );
      return grant ?? null;
    },
  };
}

function unavailable(): never {
  throw new PublicSupplierGrantError(
    'GRANT_UNAVAILABLE',
    410,
    unavailableMessage,
  );
}

export async function exchangeSupplierGrantToken(
  input: { token: unknown; now: Date },
  repository: PublicSupplierGrantRepository =
    createPrismaPublicSupplierGrantRepository(),
) {
  if (typeof input.token !== 'string' || Number.isNaN(input.now.getTime())) {
    unavailable();
  }

  let tokenDigest: string;
  try {
    tokenDigest = digestOpaqueToken('supplier-request', input.token);
  } catch {
    unavailable();
  }

  const grant = await repository.resolve({ tokenDigest });
  if (!grant) unavailable();

  const attempt = await repository.consumeAttempt({
    supplierRequestId: grant.supplierRequestId,
    now: input.now,
  });
  if (!attempt.allowed) {
    throw new PublicSupplierGrantError(
      'RATE_LIMITED',
      429,
      'Too many attempts. Try again later.',
      attempt.retryAfterSeconds,
    );
  }

  return grant;
}

export async function exchangeSupplierApplicationGrantToken(
  input: { token: unknown; now: Date },
  repository: PublicSupplierApplicationGrantRepository =
    createPrismaPublicSupplierApplicationGrantRepository(),
) {
  if (typeof input.token !== 'string' || Number.isNaN(input.now.getTime())) {
    unavailable();
  }

  let tokenDigest: string;
  try {
    tokenDigest = digestOpaqueToken('supplier-application', input.token);
  } catch {
    unavailable();
  }

  const grant = await repository.resolve({ tokenDigest });
  if (!grant) unavailable();

  const attempt = await repository.consumeAttempt({
    requestId: grant.requestId,
    now: input.now,
  });
  if (!attempt.allowed) {
    throw new PublicSupplierGrantError(
      'RATE_LIMITED',
      429,
      'Too many attempts. Try again later.',
      attempt.retryAfterSeconds,
    );
  }

  return grant;
}
