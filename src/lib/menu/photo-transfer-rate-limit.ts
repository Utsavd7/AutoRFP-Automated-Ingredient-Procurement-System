import { createHash } from 'node:crypto';

import {
  consumeDigestRateLimit,
  type RateLimitScope,
} from '@/lib/security/rate-limit';

const WINDOW_MS = 15 * 60 * 1_000;

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type RateLimitConsumer = (input: {
  scope: RateLimitScope;
  subjectDigest: string;
  limit: number;
  windowMs: number;
  now: Date;
}) => Promise<RateLimitResult>;

export type PhotoTransferRateLimitInput =
  | {
    operation: 'create';
    workspaceId: string;
    userId: string;
    now: Date;
  }
  | {
    operation: 'download' | 'upload';
    sessionId: string;
    now: Date;
  };

export type PhotoTransferRateLimit = (
  input: PhotoTransferRateLimitInput,
) => Promise<RateLimitResult>;

export function digestPhotoTransferRateLimitSubject(
  operation: PhotoTransferRateLimitInput['operation'],
  subject: string,
) {
  return createHash('sha256')
    .update(`quoteplate:v1:photo-transfer-rate-limit:${operation}:`, 'utf8')
    .update(subject, 'utf8')
    .digest('hex');
}

export function consumePhotoTransferRateLimit(
  input: PhotoTransferRateLimitInput,
  consume: RateLimitConsumer = consumeDigestRateLimit,
) {
  const configuration = input.operation === 'create'
    ? {
      scope: 'menu-photo-transfer-create' as const,
      subject: `${input.workspaceId}\u0000${input.userId}`,
      limit: 10,
    }
    : {
      scope: input.operation === 'download'
        ? 'menu-photo-transfer-download' as const
        : 'menu-photo-transfer-upload' as const,
      subject: input.sessionId,
      limit: 30,
    };

  return consume({
    scope: configuration.scope,
    subjectDigest: digestPhotoTransferRateLimitSubject(
      input.operation,
      configuration.subject,
    ),
    limit: configuration.limit,
    windowMs: WINDOW_MS,
    now: input.now,
  });
}
