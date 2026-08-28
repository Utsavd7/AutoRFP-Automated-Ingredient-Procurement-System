import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { prisma } from '@/lib/prisma';

export type RateLimitScope =
  | 'member-invitation-accept'
  | 'supplier-request';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

type RateLimitClient = Pick<PrismaClient, '$queryRaw'>;

export function digestRateLimitKey(
  scope: RateLimitScope,
  subjectDigest: string,
) {
  if (!DIGEST_PATTERN.test(subjectDigest)) {
    throw new TypeError('Invalid rate-limit subject digest.');
  }

  return createHash('sha256')
    .update(`quoteplate:v1:rate-limit:${scope}:`, 'utf8')
    .update(subjectDigest, 'ascii')
    .digest('hex');
}

export async function consumeDigestRateLimit(
  input: {
    scope: RateLimitScope;
    subjectDigest: string;
    limit: number;
    windowMs: number;
    now: Date;
  },
  client: RateLimitClient = prisma,
) {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 1_000 ||
    !Number.isSafeInteger(input.windowMs) ||
    input.windowMs < 1_000 ||
    input.windowMs > 24 * 60 * 60 * 1_000 ||
    Number.isNaN(input.now.getTime())
  ) {
    throw new TypeError('Invalid rate-limit configuration.');
  }

  const keyDigest = digestRateLimitKey(input.scope, input.subjectDigest);
  const nextResetAt = new Date(input.now.getTime() + input.windowMs);
  await assertRuntimeDatabaseRole(client);
  const [bucket] = await client.$queryRaw<
    Array<{ count: number; resetAt: Date }>
  >(Prisma.sql`
    INSERT INTO "RateLimitBucket" AS bucket (
      "keyDigest", "count", "resetAt", "updatedAt"
    )
    VALUES (${keyDigest}, 1, ${nextResetAt}, ${input.now})
    ON CONFLICT ("keyDigest") DO UPDATE SET
      "count" = CASE
        WHEN bucket."resetAt" <= ${input.now} THEN 1
        ELSE LEAST(bucket."count" + 1, ${input.limit + 1})
      END,
      "resetAt" = CASE
        WHEN bucket."resetAt" <= ${input.now} THEN ${nextResetAt}
        ELSE bucket."resetAt"
      END,
      "updatedAt" = ${input.now}
    RETURNING "count", "resetAt"
  `);
  if (!bucket) throw new Error('Unable to consume rate limit.');

  return {
    allowed: bucket.count <= input.limit,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((bucket.resetAt.getTime() - input.now.getTime()) / 1_000),
    ),
  };
}
