import {
  MAX_PHOTO_TRANSFER_BATCH_BYTES,
  MAX_PHOTO_TRANSFER_TOKEN_LENGTH,
  PHOTO_TRANSFER_METADATA_HEADER,
  encodePhotoTransferMetadataHeader,
  parsePhotoTransferFileMetadata,
  sanitizePhotoTransferFilename,
  type PhotoTransferFileMetadata,
} from '@/lib/menu/photo-transfer-contract';
import {
  decryptPhotoTransferBuffer,
  encryptPhotoTransferBuffer,
  exportPhotoTransferKey,
  generatePhotoTransferKey,
  importPhotoTransferKey,
} from '@/lib/menu/photo-crypto';
import { validateMenuPhotoSelection } from '@/lib/menu/photo-intake';

type FetchImplementation = typeof fetch;
type ReadDimensions = (file: File) => Promise<{ width: number; height: number }>;

export type PhoneTransferSession = {
  token: string;
  key: CryptoKey;
};

export type LaptopPhotoTransfer = PhoneTransferSession & {
  captureUrl: string;
  expiresAt: number;
};

export type LaptopPhotoTransferStatus = {
  status: 'waiting' | 'complete';
  expiresAt: number;
  files: PhotoTransferFileMetadata[];
};

export type LocalPhotoBatchInput = {
  workspaceId: string;
  batchId: string;
  createdAt: number;
  files: File[];
};

export class PhotoTransferClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PhotoTransferClientError';
  }
}

export class LocalPhotoPersistenceError extends Error {
  constructor(
    readonly files: File[],
    readonly batchId: string,
    options?: ErrorOptions,
  ) {
    super(
      'The photos arrived, but this browser could not save them on this laptop.',
      options,
    );
    this.name = 'LocalPhotoPersistenceError';
  }
}

export class PhotoTransferReceiptError extends Error {
  constructor(
    readonly files: File[],
    readonly batchId: string,
    options?: ErrorOptions,
  ) {
    super(
      'The photos are saved on this laptop, but the temporary transfer could not be cleared. It will expire automatically.',
      options,
    );
    this.name = 'PhotoTransferReceiptError';
  }
}

function validToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PHOTO_TRANSFER_TOKEN_LENGTH
    && !/\s/.test(value);
}

function validExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

async function responseError(response: Response, fallback: string) {
  let message = '';
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    const body = (await response.json().catch(() => null)) as null | {
      detail?: unknown;
      error?: unknown;
      title?: unknown;
    };
    const candidate = body?.detail ?? body?.error ?? body?.title;
    if (typeof candidate === 'string') message = candidate.trim();
  } else {
    message = (await response.text().catch(() => '')).trim();
  }
  if (!message) message = fallback;
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter && /^\d+$/.test(retryAfter)) {
      message = `${message} Try again in ${retryAfter} seconds.`;
    }
  }
  return new PhotoTransferClientError(message, response.status);
}

function browserFetch(fetchImpl?: FetchImplementation) {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch !== 'function') throw new Error('Photo transfer needs a web browser.');
  return fetch;
}

export async function readBrowserImageDimensions(file: File) {
  if (typeof window === 'undefined') {
    throw new Error(`${file.name} could not be read as an image.`);
  }
  if (typeof window.createImageBitmap === 'function') {
    const bitmap = await window.createImageBitmap(file);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  const previewUrl = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      image.onerror = () => reject(new Error(`${file.name} could not be read as an image.`));
      image.src = previewUrl;
    });
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

export async function createLaptopPhotoTransfer({
  origin,
  fetchImpl,
  signal,
}: {
  origin: string;
  fetchImpl?: FetchImplementation;
  signal?: AbortSignal;
}): Promise<LaptopPhotoTransfer> {
  const key = await generatePhotoTransferKey();
  const response = await browserFetch(fetchImpl)('/api/menu-photo-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create' }),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw await responseError(response, 'We could not make a phone code. Try again.');
  }
  const body = (await response.json().catch(() => null)) as null | {
    token?: unknown;
    expiresAt?: unknown;
  };
  if (!validToken(body?.token) || !validExpiry(body?.expiresAt)) {
    throw new Error('The phone transfer response was incomplete.');
  }
  const encodedKey = await exportPhotoTransferKey(key);
  const captureUrl = new URL('/menu-capture', origin);
  captureUrl.search = '';
  captureUrl.hash = new URLSearchParams({ token: body.token, key: encodedKey }).toString();
  return {
    token: body.token,
    key,
    captureUrl: captureUrl.toString(),
    expiresAt: body.expiresAt,
  };
}

export async function consumePhoneTransferFragment({
  hash,
  pathname,
  search,
  replaceState,
}: {
  hash: string;
  pathname: string;
  search: string;
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
}): Promise<PhoneTransferSession> {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(fragment);
  const token = params.get('token');
  const encodedKey = params.get('key');

  // Remove secrets before doing asynchronous key work so they do not remain in
  // browser history, screenshots of the address bar, or copied addresses.
  replaceState(null, '', `${pathname}${search}`);

  if (
    !validToken(token)
    || typeof encodedKey !== 'string'
    || encodedKey.length !== 43
    || params.getAll('token').length !== 1
    || params.getAll('key').length !== 1
    || [...params.keys()].some((key) => key !== 'token' && key !== 'key')
  ) {
    throw new Error('Invalid phone transfer link.');
  }
  return { token, key: await importPhotoTransferKey(encodedKey) };
}

export async function consumeCurrentPhoneTransferFragment() {
  if (typeof window === 'undefined') throw new Error('Invalid phone transfer link.');
  return consumePhoneTransferFragment({
    hash: window.location.hash,
    pathname: window.location.pathname,
    search: window.location.search,
    replaceState: (data, unused, url) => window.history.replaceState(data, unused, url),
  });
}

async function checkedPhotos(files: readonly File[], readDimensions: ReadDimensions) {
  const checked = await validateMenuPhotoSelection(files, readDimensions);
  const total = checked.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_PHOTO_TRANSFER_BATCH_BYTES) {
    throw new Error('Choose photos totaling no more than 40 MB.');
  }
  return checked;
}

export async function sendPhonePhotoBatch({
  files,
  token,
  key,
  readDimensions,
  onProgress,
  fetchImpl,
  signal,
}: {
  files: readonly File[];
  token: string;
  key: CryptoKey;
  readDimensions: ReadDimensions;
  onProgress?: (progress: { index: number; total: number; message: string }) => void;
  fetchImpl?: FetchImplementation;
  signal?: AbortSignal;
}) {
  if (!validToken(token)) throw new Error('Invalid phone transfer link.');
  const checked = await checkedPhotos(files, readDimensions);
  const request = browserFetch(fetchImpl);

  for (const [index, file] of checked.entries()) {
    const message = `Sending photo ${index + 1} of ${checked.length}`;
    onProgress?.({ index: index + 1, total: checked.length, message });
    const encrypted = await encryptPhotoTransferBuffer(await file.arrayBuffer(), key);
    const metadata: PhotoTransferFileMetadata = {
      index,
      name: sanitizePhotoTransferFilename(file.name),
      type: file.type as PhotoTransferFileMetadata['type'],
      size: file.size,
      encryptedSize: encrypted.ciphertext.byteLength,
      iv: encrypted.iv,
    };
    const response = await request('/api/menu-photo-transfer/upload', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        [PHOTO_TRANSFER_METADATA_HEADER]: encodePhotoTransferMetadataHeader(metadata),
      },
      body: encrypted.ciphertext,
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      throw await responseError(response, `Photo ${index + 1} could not be sent.`);
    }
  }

  const response = await request('/api/menu-photo-transfer/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'complete' }),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw await responseError(response, 'The photos were sent, but completion could not be confirmed.');
  }
}

export async function getLaptopPhotoTransferStatus({
  token,
  fetchImpl,
  signal,
}: {
  token: string;
  fetchImpl?: FetchImplementation;
  signal?: AbortSignal;
}): Promise<LaptopPhotoTransferStatus> {
  if (!validToken(token)) throw new Error('Invalid phone transfer.');
  const response = await browserFetch(fetchImpl)('/api/menu-photo-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'status', token }),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw await responseError(response, 'We could not check the phone transfer.');
  }
  const body = (await response.json().catch(() => null)) as null | {
    status?: unknown;
    expiresAt?: unknown;
    files?: unknown;
  };
  if (
    (body?.status !== 'waiting' && body?.status !== 'complete')
    || !validExpiry(body.expiresAt)
    || !Array.isArray(body.files)
  ) {
    throw new Error('The phone transfer status was incomplete.');
  }
  const files = body.files.map((file, index) => parsePhotoTransferFileMetadata(file, index));
  return { status: body.status, expiresAt: body.expiresAt, files };
}

async function downloadLaptopFiles({
  token,
  key,
  metadata,
  fetchImpl,
  signal,
}: {
  token: string;
  key: CryptoKey;
  metadata: readonly PhotoTransferFileMetadata[];
  fetchImpl?: FetchImplementation;
  signal?: AbortSignal;
}) {
  const request = browserFetch(fetchImpl);
  const files: File[] = [];
  for (const item of metadata) {
    const response = await request('/api/menu-photo-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'download', token, index: item.index }),
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      throw await responseError(response, `Photo ${item.index + 1} could not be received.`);
    }
    const ciphertext = await response.arrayBuffer();
    if (ciphertext.byteLength !== item.encryptedSize) {
      throw new Error(`Photo ${item.index + 1} was incomplete.`);
    }
    const plaintext = await decryptPhotoTransferBuffer(ciphertext, key, item.iv);
    if (plaintext.byteLength !== item.size) {
      throw new Error(`Photo ${item.index + 1} was incomplete.`);
    }
    files.push(new File([plaintext], item.name, {
      type: item.type,
      lastModified: Date.now(),
    }));
  }
  return files;
}

export async function receiveLaptopPhotoTransfer({
  token,
  key,
  workspaceId,
  metadata,
  readDimensions,
  saveBatch,
  createBatchId = () => crypto.randomUUID(),
  fetchImpl,
  signal,
}: {
  token: string;
  key: CryptoKey;
  workspaceId: string;
  metadata: readonly PhotoTransferFileMetadata[];
  readDimensions: ReadDimensions;
  saveBatch: (batch: LocalPhotoBatchInput) => Promise<void>;
  createBatchId?: () => string;
  fetchImpl?: FetchImplementation;
  signal?: AbortSignal;
}) {
  if (!validToken(token)) throw new Error('Invalid phone transfer.');
  const checkedMetadata = metadata.map((item, index) =>
    parsePhotoTransferFileMetadata(item, index));
  if (checkedMetadata.length === 0) throw new Error('No phone photos were received.');
  const files = await downloadLaptopFiles({
    token,
    key,
    metadata: checkedMetadata,
    fetchImpl,
    signal,
  });
  await checkedPhotos(files, readDimensions);
  const batchId = createBatchId();
  try {
    await saveBatch({ workspaceId, batchId, createdAt: Date.now(), files });
  } catch (cause) {
    throw new LocalPhotoPersistenceError(files, batchId, { cause });
  }

  const receipt = await browserFetch(fetchImpl)('/api/menu-photo-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'receipt', token }),
    cache: 'no-store',
    signal,
  });
  if (!receipt.ok) {
    const cause = await responseError(
      receipt,
      'The photos are saved on this laptop, but the temporary transfer could not be cleared.',
    );
    throw new PhotoTransferReceiptError(files, batchId, { cause });
  }
  return { batchId, files };
}
