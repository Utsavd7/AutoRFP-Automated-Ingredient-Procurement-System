import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import {
  MAX_PHOTO_TRANSFER_IMAGES,
  MAX_PHOTO_TRANSFER_TOKEN_LENGTH,
  PHOTO_TRANSFER_CLOCK_SKEW_MS,
  PHOTO_TRANSFER_TTL_MS,
  isPhotoTransferSessionId,
  isPhotoTransferWorkspaceId,
} from './photo-transfer-contract';

const TOKEN_VERSION = 1;
const SESSION_ID_BYTES = 24;
const SIGNATURE_BYTES = 32;
const INVALID_TOKEN_MESSAGE = 'Invalid or expired photo transfer.';

export type PhotoTransferTokenPayload = {
  version: 1;
  sessionId: string;
  workspaceId: string;
  expiresAt: number;
};

type IssuePhotoTransferTokenOptions = {
  workspaceId: string;
  secret: string;
  now?: number;
};

type VerifyPhotoTransferTokenOptions = {
  token: string;
  secret: string;
  now?: number;
};

function invalidToken(): never {
  throw new Error(INVALID_TOKEN_MESSAGE);
}

function validNow(now: number) {
  return Number.isSafeInteger(now) && now > 0;
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return invalidToken();

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) return invalidToken();
  return decoded;
}

function hasExactPayloadKeys(value: Record<string, unknown>) {
  const expected = ['version', 'sessionId', 'workspaceId', 'expiresAt'];
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => key in value);
}

export function issuePhotoTransferToken({
  workspaceId,
  secret,
  now = Date.now(),
}: IssuePhotoTransferTokenOptions) {
  if (!isPhotoTransferWorkspaceId(workspaceId)) {
    throw new Error('A valid workspace ID is required.');
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('A photo transfer signing secret is required.');
  }
  if (!validNow(now)) throw new Error('A valid current time is required.');

  const sessionId = randomBytes(SESSION_ID_BYTES).toString('base64url');
  const expiresAt = now + PHOTO_TRANSFER_TTL_MS;
  const payload: PhotoTransferTokenPayload = {
    version: TOKEN_VERSION,
    sessionId,
    workspaceId,
    expiresAt,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  const token = `${encodedPayload}.${signature}`;
  if (token.length > MAX_PHOTO_TRANSFER_TOKEN_LENGTH) {
    throw new Error('Photo transfer token exceeds maximum length.');
  }

  return {
    token,
    sessionId,
    expiresAt,
  };
}

export function verifyPhotoTransferToken({
  token,
  secret,
  now = Date.now(),
}: VerifyPhotoTransferTokenOptions): PhotoTransferTokenPayload {
  try {
    if (
      typeof token !== 'string'
      || token.length === 0
      || token.length > MAX_PHOTO_TRANSFER_TOKEN_LENGTH
      || typeof secret !== 'string'
      || secret.length === 0
      || !validNow(now)
    ) {
      return invalidToken();
    }

    const parts = token.split('.');
    if (parts.length !== 2) return invalidToken();
    const [encodedPayload, encodedSignature] = parts;
    const payloadBytes = decodeBase64Url(encodedPayload);
    const providedSignature = decodeBase64Url(encodedSignature);
    const expectedSignature = createHmac('sha256', secret)
      .update(encodedPayload)
      .digest();
    const normalizedSignature = Buffer.alloc(SIGNATURE_BYTES);
    providedSignature.copy(normalizedSignature, 0, 0, SIGNATURE_BYTES);
    const signatureMatches = timingSafeEqual(expectedSignature, normalizedSignature);
    if (providedSignature.length !== SIGNATURE_BYTES || !signatureMatches) {
      return invalidToken();
    }

    const parsed = JSON.parse(payloadBytes.toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return invalidToken();
    }
    const payload = parsed as Record<string, unknown>;
    if (
      !hasExactPayloadKeys(payload)
      || payload.version !== TOKEN_VERSION
      || !isPhotoTransferSessionId(payload.sessionId)
      || !isPhotoTransferWorkspaceId(payload.workspaceId)
      || !Number.isSafeInteger(payload.expiresAt)
    ) {
      return invalidToken();
    }

    const expiresAt = Number(payload.expiresAt);
    if (
      expiresAt <= now
      || expiresAt > now + PHOTO_TRANSFER_TTL_MS + PHOTO_TRANSFER_CLOCK_SKEW_MS
    ) {
      return invalidToken();
    }

    return {
      version: TOKEN_VERSION,
      sessionId: payload.sessionId,
      workspaceId: payload.workspaceId,
      expiresAt,
    };
  } catch {
    return invalidToken();
  }
}

function validateStorageSessionId(sessionId: string) {
  if (!isPhotoTransferSessionId(sessionId)) {
    throw new Error('Invalid photo transfer session.');
  }
}

export function derivePhotoTransferSessionPrefix(sessionId: string) {
  validateStorageSessionId(sessionId);
  const digest = createHash('sha256').update(sessionId, 'utf8').digest('hex');
  return `sessions/${digest}`;
}

export function derivePhotoTransferManifestKey(sessionId: string) {
  return `${derivePhotoTransferSessionPrefix(sessionId)}/manifest.json`;
}

export function derivePhotoTransferFileKey(sessionId: string, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PHOTO_TRANSFER_IMAGES) {
    throw new Error('Invalid photo transfer file index.');
  }
  return `${derivePhotoTransferSessionPrefix(sessionId)}/files/${index}.bin`;
}
