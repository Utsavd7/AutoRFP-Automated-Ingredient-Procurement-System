import { createHash } from 'node:crypto';

import {
  consumeDigestRateLimit,
  type RateLimitScope,
} from '@/lib/security/rate-limit';

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type AuthRateLimitConsumer = (input: {
  scope: RateLimitScope;
  subjectDigest: string;
  limit: number;
  windowMs: number;
  now: Date;
}) => Promise<RateLimitResult>;

type AuthRateLimitInput = {
  email: unknown;
  clientIdentifier?: string | null;
  now: Date;
};

const HOUR_MS = 60 * 60 * 1_000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;

function normalizedSubject(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function digestAuthRateLimitSubject(
  dimension: 'client' | 'email',
  value: string,
) {
  return createHash('sha256')
    .update(`quoteplate:v1:auth-rate-limit-subject:${dimension}:`, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

export function authClientIdentifier(headers: Headers) {
  const direct =
    normalizedSubject(headers.get('cf-connecting-ip')) ??
    normalizedSubject(headers.get('x-real-ip'));
  if (direct) return direct;

  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) return null;
  const lastHop = forwarded.split(',').at(-1);
  return normalizedSubject(lastHop);
}

async function consumeAuthRateLimit(
  input: AuthRateLimitInput,
  configuration: {
    email: { scope: RateLimitScope; limit: number; windowMs: number };
    client: { scope: RateLimitScope; limit: number; windowMs: number };
  },
  consume: AuthRateLimitConsumer,
) {
  const email = normalizedSubject(input.email);
  const clientIdentifier = normalizedSubject(input.clientIdentifier);
  const attempts = [
    email
      ? consume({
          ...configuration.email,
          subjectDigest: digestAuthRateLimitSubject('email', email),
          now: input.now,
        })
      : null,
    clientIdentifier
      ? consume({
          ...configuration.client,
          subjectDigest: digestAuthRateLimitSubject('client', clientIdentifier),
          now: input.now,
        })
      : null,
  ].filter((attempt): attempt is Promise<RateLimitResult> => attempt !== null);

  if (!attempts.length) return { allowed: true, retryAfterSeconds: 1 };
  const results = await Promise.all(attempts);
  const denied = results.filter((result) => !result.allowed);
  return {
    allowed: denied.length === 0,
    retryAfterSeconds: Math.max(
      1,
      ...(denied.length ? denied : results).map(
        (result) => result.retryAfterSeconds,
      ),
    ),
  };
}

export function consumeWorkspaceCreationRateLimit(
  input: AuthRateLimitInput & { request: Request },
  consume: AuthRateLimitConsumer = consumeDigestRateLimit,
) {
  return consumeAuthRateLimit(
    {
      ...input,
      clientIdentifier:
        input.clientIdentifier ?? authClientIdentifier(input.request.headers),
    },
    {
      email: {
        scope: 'auth-workspace-create-email',
        limit: 5,
        windowMs: HOUR_MS,
      },
      client: {
        scope: 'auth-workspace-create-client',
        limit: 30,
        windowMs: HOUR_MS,
      },
    },
    consume,
  );
}

export function consumeCredentialsRateLimit(
  input: AuthRateLimitInput,
  consume: AuthRateLimitConsumer = consumeDigestRateLimit,
) {
  return consumeAuthRateLimit(
    input,
    {
      email: {
        scope: 'auth-credentials-email',
        limit: 10,
        windowMs: FIFTEEN_MINUTES_MS,
      },
      client: {
        scope: 'auth-credentials-client',
        limit: 100,
        windowMs: FIFTEEN_MINUTES_MS,
      },
    },
    consume,
  );
}
