import { createHash } from 'node:crypto';

import { consumeDigestRateLimit } from '@/lib/security/rate-limit';

export type PublicClientLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type PublicClientRateLimit = (input: {
  request: Request;
  now: Date;
}) => Promise<PublicClientLimitResult>;

export type PublicClientOperation =
  | 'invitation-accept'
  | 'quote-access'
  | 'quote-read'
  | 'quote-submit';

const limits = {
  'invitation-accept': {
    scope: 'member-invitation-accept-client',
    limit: 30,
  },
  'quote-access': {
    scope: 'supplier-quote-access-client',
    limit: 60,
  },
  'quote-read': {
    scope: 'supplier-quote-read-client',
    limit: 240,
  },
  'quote-submit': {
    scope: 'supplier-quote-submit-client',
    limit: 30,
  },
} as const;

const WINDOW_MS = 15 * 60 * 1_000;

function normalizedHeader(value: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function clientIdentifier(
  headers: Headers,
  environment: { NODE_ENV?: string; VERCEL?: string } = process.env,
) {
  if (environment.NODE_ENV === 'production') {
    if (environment.VERCEL !== '1') return 'production-unidentified';
    return normalizedHeader(
      headers.get('x-vercel-forwarded-for')?.split(',')[0] ?? null,
    ) ?? 'production-unidentified';
  }
  const direct =
    normalizedHeader(headers.get('cf-connecting-ip')) ??
    normalizedHeader(headers.get('x-real-ip'));
  if (direct) return direct;

  const forwarded = headers.get('x-forwarded-for');
  return normalizedHeader(forwarded?.split(',').at(-1) ?? null) ?? 'unidentified';
}

export function publicClientRateLimitDigest(
  operation: PublicClientOperation,
  headers: Headers,
  environment: { NODE_ENV?: string; VERCEL?: string } = process.env,
) {
  return createHash('sha256')
    .update(`quoteplate:v1:public-client:${operation}:`, 'utf8')
    .update(clientIdentifier(headers, environment), 'utf8')
    .digest('hex');
}

export function publicClientRateLimit(operation: PublicClientOperation) {
  const configuration = limits[operation];
  return ({ request, now }: Parameters<PublicClientRateLimit>[0]) =>
    consumeDigestRateLimit({
      scope: configuration.scope,
      subjectDigest: publicClientRateLimitDigest(operation, request.headers),
      limit: configuration.limit,
      windowMs: WINDOW_MS,
      now,
    });
}
