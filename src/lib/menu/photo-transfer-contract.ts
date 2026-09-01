export const PHOTO_TRANSFER_TTL_MS = 15 * 60 * 1_000;
export const PHOTO_TRANSFER_CLOCK_SKEW_MS = 60 * 1_000;
export const MAX_PHOTO_TRANSFER_IMAGES = 10;
export const MAX_PHOTO_TRANSFER_IMAGE_BYTES = 8 * 1_024 * 1_024;
export const MAX_PHOTO_TRANSFER_BATCH_BYTES = 40 * 1_024 * 1_024;
export const MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES = 16;
export const MAX_PHOTO_TRANSFER_FILENAME_LENGTH = 120;
export const MAX_PHOTO_TRANSFER_TOKEN_LENGTH = 1_024;

export const PHOTO_TRANSFER_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type PhotoTransferMimeType = typeof PHOTO_TRANSFER_MIME_TYPES[number];

export type PhotoTransferFileMetadata = {
  index: number;
  name: string;
  type: PhotoTransferMimeType;
  size: number;
  encryptedSize: number;
  iv: string;
};

export type PhotoTransferManifest = {
  sessionId: string;
  workspaceId: string;
  expiresAt: number;
  completedAt?: number;
  files: PhotoTransferFileMetadata[];
};

const MIME_TYPE_SET = new Set<string>(PHOTO_TRANSFER_MIME_TYPES);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const IV_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const CONTROL_OR_PATH_PATTERN = /[\\/\u0000-\u001f\u007f]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const keys = Object.keys(value);
  return required.every((key) => key in value)
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

export function isPhotoTransferSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function isPhotoTransferWorkspaceId(value: unknown): value is string {
  return typeof value === 'string'
    && WORKSPACE_ID_PATTERN.test(value);
}

export function sanitizePhotoTransferFilename(value: string) {
  const normalized = value
    .normalize('NFKC')
    .replace(CONTROL_OR_PATH_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  const bounded = Array.from(normalized)
    .slice(0, MAX_PHOTO_TRANSFER_FILENAME_LENGTH)
    .join('')
    .trim();

  return bounded || 'photo';
}

function invalidManifest(): never {
  throw new Error('Invalid photo transfer manifest.');
}

function parseFileMetadata(
  value: unknown,
  expectedIndex: number,
): PhotoTransferFileMetadata {
  if (!isRecord(value) || !hasExactKeys(value, [
    'index',
    'name',
    'type',
    'size',
    'encryptedSize',
    'iv',
  ])) {
    return invalidManifest();
  }

  if (
    value.index !== expectedIndex
    || !Number.isInteger(value.index)
    || expectedIndex < 0
    || expectedIndex >= MAX_PHOTO_TRANSFER_IMAGES
    || typeof value.name !== 'string'
    || value.name !== sanitizePhotoTransferFilename(value.name)
    || !MIME_TYPE_SET.has(String(value.type))
    || !Number.isSafeInteger(value.size)
    || Number(value.size) <= 0
    || Number(value.size) > MAX_PHOTO_TRANSFER_IMAGE_BYTES
    || !Number.isSafeInteger(value.encryptedSize)
    || Number(value.encryptedSize)
      !== Number(value.size) + MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES
    || typeof value.iv !== 'string'
    || !IV_PATTERN.test(value.iv)
  ) {
    return invalidManifest();
  }

  return {
    index: expectedIndex,
    name: value.name,
    type: value.type as PhotoTransferMimeType,
    size: Number(value.size),
    encryptedSize: Number(value.encryptedSize),
    iv: value.iv,
  };
}

export function parsePhotoTransferManifest(stored: unknown): PhotoTransferManifest {
  let value: unknown = stored;

  if (typeof stored === 'string') {
    try {
      value = JSON.parse(stored);
    } catch {
      return invalidManifest();
    }
  }

  if (!isRecord(value) || !hasExactKeys(
    value,
    ['sessionId', 'workspaceId', 'expiresAt', 'files'],
    ['completedAt'],
  )) {
    return invalidManifest();
  }

  if (
    !isPhotoTransferSessionId(value.sessionId)
    || !isPhotoTransferWorkspaceId(value.workspaceId)
    || !Number.isSafeInteger(value.expiresAt)
    || Number(value.expiresAt) <= 0
    || !Array.isArray(value.files)
    || value.files.length > MAX_PHOTO_TRANSFER_IMAGES
  ) {
    return invalidManifest();
  }

  const expiresAt = Number(value.expiresAt);
  let completedAt: number | undefined;
  if (value.completedAt !== undefined) {
    if (
      !Number.isSafeInteger(value.completedAt)
      || Number(value.completedAt) <= 0
      || Number(value.completedAt) > expiresAt
    ) {
      return invalidManifest();
    }
    completedAt = Number(value.completedAt);
  }

  const files = value.files.map((file, index) => parseFileMetadata(file, index));
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  if (totalSize > MAX_PHOTO_TRANSFER_BATCH_BYTES) return invalidManifest();

  return {
    sessionId: value.sessionId,
    workspaceId: value.workspaceId,
    expiresAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    files,
  };
}
