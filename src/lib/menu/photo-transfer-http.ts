import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import {
  RequestBodyTooLargeError,
  readBoundedJson,
} from '@/lib/api/read-bounded-json';
import {
  MAX_PHOTO_TRANSFER_BATCH_BYTES,
  MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES,
  MAX_PHOTO_TRANSFER_IMAGE_BYTES,
  MAX_PHOTO_TRANSFER_IMAGES,
  MAX_PHOTO_TRANSFER_TOKEN_LENGTH,
  PHOTO_TRANSFER_METADATA_HEADER,
  PhotoTransferMetadataHeaderError,
  parsePhotoTransferMetadataHeader,
  type PhotoTransferFileMetadata,
} from '@/lib/menu/photo-transfer-contract';
import type {
  PhotoTransferRateLimit,
  PhotoTransferRateLimitInput,
} from '@/lib/menu/photo-transfer-rate-limit';
import type {
  PhotoTransferStore,
  StoredPhotoTransferManifest,
} from '@/lib/menu/photo-transfer-store';
import {
  issuePhotoTransferToken,
  verifyPhotoTransferToken,
  type PhotoTransferTokenPayload,
} from '@/lib/menu/photo-transfer';
import type { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  browserMutationOriginRejection,
} from '@/lib/security/browser-mutation';

const MAX_PHOTO_TRANSFER_JSON_BYTES = 4 * 1_024;
const MIN_PHOTO_TRANSFER_SECRET_LENGTH = 32;
const EXPIRED_CLEANUP_LIMIT = 1;
const MAX_ENCRYPTED_IMAGE_BYTES = MAX_PHOTO_TRANSFER_IMAGE_BYTES
  + MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES;

type AccountContext = Awaited<ReturnType<typeof requireAccountContext>>;

export type PhotoTransferRouteDependencies = {
  accountContext: () => Promise<AccountContext>;
  storeFactory: () => PhotoTransferStore;
  getSecret: () => string | undefined;
  now: () => number;
  rateLimit: PhotoTransferRateLimit;
};

type LaptopCommand =
  | { action: 'create' }
  | { action: 'status'; token: string }
  | { action: 'download'; token: string; index: number }
  | { action: 'receipt'; token: string };

class InvalidPhotoTransferCommandError extends Error {}
class UploadBodyTooLargeError extends Error {}
class UploadBodyMismatchError extends Error {}

function privateProblem(status: number, title: string, detail: string) {
  return privateNoStoreResponse(problemResponse(status, title, detail));
}

function privateJson(body: unknown, init?: ResponseInit) {
  return privateNoStoreResponse(Response.json(body, init));
}

function unavailableResponse() {
  return privateProblem(
    410,
    'Transfer unavailable',
    'This photo transfer is unavailable or has expired.',
  );
}

function serviceUnavailableResponse() {
  return privateProblem(
    503,
    'Photo transfer unavailable',
    'Photo transfer is unavailable right now. Upload photos from this device instead.',
  );
}

function conflictResponse(detail: string) {
  return privateProblem(409, 'Photo transfer changed', detail);
}

function rateLimitedResponse(retryAfterSeconds: number) {
  const response = privateProblem(
    429,
    'Too many photo transfer attempts',
    'Too many photo transfer attempts were made. Try again later.',
  );
  response.headers.set('Retry-After', String(retryAfterSeconds));
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function isBoundedToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PHOTO_TRANSFER_TOKEN_LENGTH;
}

function parseLaptopCommand(value: unknown): LaptopCommand {
  if (!isRecord(value) || typeof value.action !== 'string') {
    throw new InvalidPhotoTransferCommandError();
  }

  if (value.action === 'create' && hasExactKeys(value, ['action'])) {
    return { action: 'create' };
  }
  if (
    (value.action === 'status' || value.action === 'receipt')
    && hasExactKeys(value, ['action', 'token'])
    && isBoundedToken(value.token)
  ) {
    return { action: value.action, token: value.token };
  }
  if (
    value.action === 'download'
    && hasExactKeys(value, ['action', 'token', 'index'])
    && isBoundedToken(value.token)
    && Number.isInteger(value.index)
    && Number(value.index) >= 0
    && Number(value.index) < MAX_PHOTO_TRANSFER_IMAGES
  ) {
    return { action: 'download', token: value.token, index: Number(value.index) };
  }
  throw new InvalidPhotoTransferCommandError();
}

function parseCompleteCommand(value: unknown) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['action'])
    || value.action !== 'complete'
  ) {
    throw new InvalidPhotoTransferCommandError();
  }
}

function activeContext(context: AccountContext) {
  return context
    && context.user.accountState === 'ACTIVE'
    && context.user.isActive
    && context.user.tenantId === context.tenant.id
    ? context
    : null;
}

function signingSecret(dependencies: PhotoTransferRouteDependencies) {
  try {
    const secret = dependencies.getSecret()?.trim();
    return secret && secret.length >= MIN_PHOTO_TRANSFER_SECRET_LENGTH
      ? secret
      : null;
  } catch {
    return null;
  }
}

function currentTime(dependencies: PhotoTransferRouteDependencies) {
  try {
    const now = dependencies.now();
    return Number.isSafeInteger(now) && now > 0 ? now : null;
  } catch {
    return null;
  }
}

type VerifiedToken = {
  payload: PhotoTransferTokenPayload;
  expired: boolean;
};

function encodedTokenExpiry(token: string) {
  try {
    const [encodedPayload] = token.split('.');
    if (!encodedPayload || !/^[A-Za-z0-9_-]+$/.test(encodedPayload)) return null;
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as unknown;
    if (!isRecord(parsed) || !Number.isSafeInteger(parsed.expiresAt)) return null;
    return Number(parsed.expiresAt);
  } catch {
    return null;
  }
}

function verifiedToken(token: string, secret: string, now: number): VerifiedToken | null {
  try {
    return {
      payload: verifyPhotoTransferToken({ token, secret, now }),
      expired: false,
    };
  } catch {
    const expiresAt = encodedTokenExpiry(token);
    if (expiresAt === null || expiresAt > now || expiresAt <= 1) return null;
    try {
      return {
        payload: verifyPhotoTransferToken({ token, secret, now: expiresAt - 1 }),
        expired: true,
      };
    } catch {
      return null;
    }
  }
}

function manifestMatchesToken(
  stored: StoredPhotoTransferManifest,
  payload: PhotoTransferTokenPayload,
) {
  return stored.manifest.sessionId === payload.sessionId
    && stored.manifest.workspaceId === payload.workspaceId
    && stored.manifest.expiresAt === payload.expiresAt;
}

type StoredSessionResult =
  | { kind: 'available'; stored: StoredPhotoTransferManifest }
  | { kind: 'missing' }
  | { kind: 'failure' };

async function loadStoredSession(
  store: PhotoTransferStore,
  payload: PhotoTransferTokenPayload,
  now: number,
): Promise<StoredSessionResult> {
  let stored: StoredPhotoTransferManifest | null;
  try {
    stored = await store.getManifest(payload.sessionId);
  } catch {
    return { kind: 'failure' };
  }
  if (stored === null || !manifestMatchesToken(stored, payload)) {
    return { kind: 'missing' };
  }
  if (stored.manifest.expiresAt <= now) {
    try {
      await store.deleteSession(payload.sessionId);
    } catch {
      // Expired transfer cleanup is deliberately best effort.
    }
    return { kind: 'missing' };
  }
  return { kind: 'available', stored };
}

async function cleanupExpiredSignedSession(
  store: PhotoTransferStore,
  payload: PhotoTransferTokenPayload,
) {
  try {
    const stored = await store.getManifest(payload.sessionId);
    if (stored !== null && manifestMatchesToken(stored, payload)) {
      await store.deleteSession(payload.sessionId);
    }
  } catch {
    // A valid expired transfer always gets the same generic response.
  }
}

function isStorageConflict(error: unknown) {
  return error instanceof Error && (
    error.message === 'Photo transfer manifest write conflict.'
    || error.message === 'Photo transfer ciphertext already exists.'
  );
}

function sameFileMetadata(
  left: PhotoTransferFileMetadata,
  right: PhotoTransferFileMetadata,
) {
  return left.index === right.index
    && left.name === right.name
    && left.type === right.type
    && left.size === right.size
    && left.encryptedSize === right.encryptedSize
    && left.iv === right.iv;
}

async function reconcileManifestWrite(
  store: PhotoTransferStore,
  payload: PhotoTransferTokenPayload,
  previous: StoredPhotoTransferManifest,
  file: PhotoTransferFileMetadata,
) {
  let current: StoredPhotoTransferManifest | null;
  try {
    current = await store.getManifest(payload.sessionId);
  } catch {
    return 'unknown' as const;
  }
  if (current === null) return 'uncommitted' as const;
  if (!manifestMatchesToken(current, payload)) return 'unknown' as const;
  const committedFile = current.manifest.files[file.index];
  if (committedFile && sameFileMetadata(committedFile, file)) {
    return 'committed' as const;
  }
  return current.etag === previous.etag
    ? 'uncommitted' as const
    : 'unknown' as const;
}

async function deleteOwnedCiphertext(
  store: PhotoTransferStore,
  sessionId: string,
  index: number,
) {
  try {
    await store.deleteCiphertext(sessionId, index);
  } catch {
    // Bounded session cleanup remains the fallback.
  }
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer ([^\s,]+)$/i);
  return match && isBoundedToken(match[1]) ? match[1] : null;
}

function isOctetStream(request: Request) {
  return request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase() === 'application/octet-stream';
}

async function readUploadBody(request: Request, expectedBytes: number) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new UploadBodyMismatchError();
    const length = Number(declaredLength);
    if (length > MAX_ENCRYPTED_IMAGE_BYTES) throw new UploadBodyTooLargeError();
    if (length !== expectedBytes) throw new UploadBodyMismatchError();
  }
  if (request.body === null) throw new UploadBodyMismatchError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ENCRYPTED_IMAGE_BYTES) {
        await reader.cancel();
        throw new UploadBodyTooLargeError();
      }
      if (totalBytes > expectedBytes) {
        await reader.cancel();
        throw new UploadBodyMismatchError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes !== expectedBytes) throw new UploadBodyMismatchError();

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function transferStatus(stored: StoredPhotoTransferManifest) {
  return {
    status: stored.manifest.completedAt === undefined ? 'waiting' : 'complete',
    expiresAt: stored.manifest.expiresAt,
    files: stored.manifest.files,
  };
}

export function createPhotoTransferRouteHandlers(
  dependencies: PhotoTransferRouteDependencies,
) {
  function storeInstance() {
    try {
      return dependencies.storeFactory();
    } catch {
      return null;
    }
  }

  async function rateLimit(input: PhotoTransferRateLimitInput) {
    try {
      const result = await dependencies.rateLimit(input);
      if (
        typeof result.allowed !== 'boolean'
        || !Number.isSafeInteger(result.retryAfterSeconds)
        || result.retryAfterSeconds < 1
        || result.retryAfterSeconds > 24 * 60 * 60
      ) {
        return serviceUnavailableResponse();
      }
      return result.allowed
        ? null
        : rateLimitedResponse(result.retryAfterSeconds);
    } catch {
      return serviceUnavailableResponse();
    }
  }

  async function readJsonCommand(request: Request) {
    try {
      return await readBoundedJson(request, MAX_PHOTO_TRANSFER_JSON_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return privateProblem(
          413,
          'Request too large',
          'Photo transfer commands must be smaller than 4 KB.',
        );
      }
      return privateProblem(
        400,
        'Invalid request',
        'Provide a valid JSON photo transfer command.',
      );
    }
  }

  async function phoneSession(token: string): Promise<Response | {
    store: PhotoTransferStore;
    payload: PhotoTransferTokenPayload;
    stored: StoredPhotoTransferManifest;
    now: number;
  }> {
    const secret = signingSecret(dependencies);
    const now = currentTime(dependencies);
    if (secret === null || now === null) return serviceUnavailableResponse();

    const verification = verifiedToken(token, secret, now);
    if (verification === null) return unavailableResponse();
    if (verification.expired) {
      const store = storeInstance();
      if (store === null) return serviceUnavailableResponse();
      await cleanupExpiredSignedSession(store, verification.payload);
      return unavailableResponse();
    }
    const limited = await rateLimit({
      operation: 'upload',
      sessionId: verification.payload.sessionId,
      now: new Date(now),
    });
    if (limited) return limited;
    const store = storeInstance();
    if (store === null) return serviceUnavailableResponse();

    const loaded = await loadStoredSession(store, verification.payload, now);
    if (loaded.kind === 'failure') return serviceUnavailableResponse();
    if (loaded.kind === 'missing') return unavailableResponse();
    return { store, payload: verification.payload, stored: loaded.stored, now };
  }

  async function laptopPOST(request: Request) {
    const rejection = browserJsonMutationRejection(request);
    if (rejection === 'CROSS_ORIGIN') {
      return privateProblem(
        403,
        'Request not allowed',
        'Use photo transfer from the QuotePlate workspace.',
      );
    }
    if (rejection === 'UNSUPPORTED_MEDIA_TYPE') {
      return privateProblem(
        415,
        'Unsupported media type',
        'Send this request as application/json.',
      );
    }

    const parsed = await readJsonCommand(request);
    if (parsed instanceof Response) return parsed;
    let command: LaptopCommand;
    try {
      command = parseLaptopCommand(parsed);
    } catch {
      return privateProblem(
        400,
        'Invalid request',
        'Provide a valid photo transfer action.',
      );
    }

    let account: ReturnType<typeof activeContext>;
    try {
      account = activeContext(await dependencies.accountContext());
    } catch {
      return serviceUnavailableResponse();
    }
    if (!account) {
      return privateProblem(401, 'Unauthorized', 'Authentication is required.');
    }

    const secret = signingSecret(dependencies);
    const now = currentTime(dependencies);
    if (secret === null || now === null) return serviceUnavailableResponse();

    if (command.action === 'create') {
      const limited = await rateLimit({
        operation: 'create',
        workspaceId: account.tenant.id,
        userId: account.user.id,
        now: new Date(now),
      });
      if (limited) return limited;
      const store = storeInstance();
      if (store === null) return serviceUnavailableResponse();
      try {
        const candidates = await store.listExpiredSessionCandidates(
          now,
          EXPIRED_CLEANUP_LIMIT,
        );
        for (const candidate of candidates.slice(0, EXPIRED_CLEANUP_LIMIT)) {
          try {
            await store.deleteSession(candidate.manifest.sessionId);
          } catch {
            // Cleanup must never prevent a new transfer.
          }
        }
      } catch {
        // Expiry scans are opportunistic and bounded.
      }

      try {
        const issued = issuePhotoTransferToken({
          workspaceId: account.tenant.id,
          secret,
          now,
        });
        await store.setManifest(issued.sessionId, {
          sessionId: issued.sessionId,
          workspaceId: account.tenant.id,
          expiresAt: issued.expiresAt,
          files: [],
        }, { onlyIfNew: true });
        return privateJson({
          token: issued.token,
          expiresAt: issued.expiresAt,
        }, { status: 201 });
      } catch (error) {
        return isStorageConflict(error)
          ? conflictResponse('Unable to create this transfer. Retry from the workspace.')
          : serviceUnavailableResponse();
      }
    }

    const verification = verifiedToken(command.token, secret, now);
    if (
      verification === null
      || verification.payload.workspaceId !== account.tenant.id
    ) {
      return unavailableResponse();
    }
    const { payload } = verification;
    if (verification.expired) {
      const store = storeInstance();
      if (store === null) return serviceUnavailableResponse();
      await cleanupExpiredSignedSession(store, payload);
      return unavailableResponse();
    }
    if (command.action === 'download') {
      const limited = await rateLimit({
        operation: 'download',
        sessionId: payload.sessionId,
        now: new Date(now),
      });
      if (limited) return limited;
    }
    const store = storeInstance();
    if (store === null) return serviceUnavailableResponse();
    const loaded = await loadStoredSession(store, payload, now);
    if (loaded.kind === 'failure') return serviceUnavailableResponse();

    if (command.action === 'receipt' && loaded.kind === 'missing') {
      return privateNoStoreResponse(new Response(null, { status: 204 }));
    }
    if (loaded.kind === 'missing') return unavailableResponse();

    if (command.action === 'status') {
      return privateJson(transferStatus(loaded.stored));
    }
    if (command.action === 'download') {
      if (loaded.stored.manifest.completedAt === undefined) {
        return conflictResponse('Complete the phone upload before downloading photos.');
      }
      const file = loaded.stored.manifest.files[command.index];
      if (!file || file.index !== command.index) return unavailableResponse();

      let ciphertext: ArrayBuffer | null;
      try {
        ciphertext = await store.getCiphertext(payload.sessionId, command.index);
      } catch {
        return serviceUnavailableResponse();
      }
      if (ciphertext === null || ciphertext.byteLength !== file.encryptedSize) {
        return unavailableResponse();
      }
      return privateNoStoreResponse(new Response(ciphertext, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(ciphertext.byteLength),
        },
      }));
    }

    if (loaded.stored.manifest.completedAt === undefined) {
      return conflictResponse('Complete the phone upload before confirming receipt.');
    }
    try {
      await store.deleteSession(payload.sessionId);
      return privateNoStoreResponse(new Response(null, { status: 204 }));
    } catch {
      return serviceUnavailableResponse();
    }
  }

  async function uploadPUT(request: Request) {
    if (browserMutationOriginRejection(request) !== null) {
      return privateProblem(
        403,
        'Request not allowed',
        'Open this transfer from its QuotePlate phone link.',
      );
    }
    if (!isOctetStream(request)) {
      return privateProblem(
        415,
        'Unsupported media type',
        'Send encrypted photos as application/octet-stream.',
      );
    }

    const token = bearerToken(request);
    if (token === null) return unavailableResponse();

    let file: PhotoTransferFileMetadata;
    try {
      file = parsePhotoTransferMetadataHeader(
        request.headers.get(PHOTO_TRANSFER_METADATA_HEADER),
      );
    } catch (error) {
      const malformed = error instanceof PhotoTransferMetadataHeaderError
        && error.kind === 'MALFORMED';
      return privateProblem(
        malformed ? 400 : 422,
        'Invalid photo metadata',
        'Provide valid bounded metadata for this encrypted photo.',
      );
    }

    const session = await phoneSession(token);
    if (session instanceof Response) return session;
    const { store, payload, stored } = session;
    if (stored.manifest.completedAt !== undefined) {
      return conflictResponse('This photo transfer is already complete.');
    }
    if (stored.manifest.files.length >= MAX_PHOTO_TRANSFER_IMAGES) {
      return conflictResponse('This photo transfer already has the maximum number of photos.');
    }
    if (file.index !== stored.manifest.files.length) {
      return conflictResponse('Photos must be uploaded in order. Retry this photo.');
    }
    const totalSize = stored.manifest.files.reduce(
      (total, uploaded) => total + uploaded.size,
      file.size,
    );
    if (totalSize > MAX_PHOTO_TRANSFER_BATCH_BYTES) {
      return privateProblem(
        422,
        'Photo batch too large',
        'Choose photos totaling no more than 40 MB.',
      );
    }

    let ciphertext: ArrayBuffer;
    try {
      ciphertext = await readUploadBody(request, file.encryptedSize);
    } catch (error) {
      if (error instanceof UploadBodyTooLargeError) {
        return privateProblem(
          413,
          'Photo too large',
          'Each encrypted photo must be no larger than 8 MB plus encryption overhead.',
        );
      }
      return privateProblem(
        422,
        'Invalid encrypted photo',
        'The encrypted photo size does not match its metadata.',
      );
    }

    try {
      await store.putCiphertext(payload.sessionId, file.index, ciphertext);
    } catch (error) {
      return isStorageConflict(error)
        ? conflictResponse('This photo changed while uploading. Retry it.')
        : serviceUnavailableResponse();
    }

    try {
      await store.setManifest(payload.sessionId, {
        ...stored.manifest,
        files: [...stored.manifest.files, file],
      }, { onlyIfMatch: stored.etag });
    } catch (error) {
      if (isStorageConflict(error)) {
        await deleteOwnedCiphertext(store, payload.sessionId, file.index);
        return conflictResponse(
          'This photo transfer changed while uploading. Retry this photo.',
        );
      }
      const reconciliation = await reconcileManifestWrite(
        store,
        payload,
        stored,
        file,
      );
      if (reconciliation === 'committed') {
        return privateJson({ uploaded: true, index: file.index }, { status: 201 });
      }
      if (reconciliation === 'uncommitted') {
        await deleteOwnedCiphertext(store, payload.sessionId, file.index);
      }
      return serviceUnavailableResponse();
    }

    return privateJson({ uploaded: true, index: file.index }, { status: 201 });
  }

  async function uploadPOST(request: Request) {
    const rejection = browserJsonMutationRejection(request);
    if (rejection === 'CROSS_ORIGIN') {
      return privateProblem(
        403,
        'Request not allowed',
        'Open this transfer from its QuotePlate phone link.',
      );
    }
    if (rejection === 'UNSUPPORTED_MEDIA_TYPE') {
      return privateProblem(
        415,
        'Unsupported media type',
        'Send this request as application/json.',
      );
    }

    const token = bearerToken(request);
    if (token === null) return unavailableResponse();
    const parsed = await readJsonCommand(request);
    if (parsed instanceof Response) return parsed;
    try {
      parseCompleteCommand(parsed);
    } catch {
      return privateProblem(
        400,
        'Invalid request',
        'Provide the exact photo transfer completion action.',
      );
    }

    const session = await phoneSession(token);
    if (session instanceof Response) return session;
    const { store, payload, stored, now } = session;
    if (
      stored.manifest.files.length < 1
      || stored.manifest.files.length > MAX_PHOTO_TRANSFER_IMAGES
    ) {
      return privateProblem(
        422,
        'No photos uploaded',
        'Upload at least one photo before completing the transfer.',
      );
    }
    if (stored.manifest.completedAt !== undefined) {
      return privateJson(transferStatus(stored));
    }

    const completed = {
      ...stored.manifest,
      completedAt: now,
    };
    try {
      await store.setManifest(
        payload.sessionId,
        completed,
        { onlyIfMatch: stored.etag },
      );
    } catch (error) {
      return isStorageConflict(error)
        ? conflictResponse('This transfer changed while completing. Retry completion.')
        : serviceUnavailableResponse();
    }
    return privateJson({
      status: 'complete',
      expiresAt: completed.expiresAt,
      files: completed.files,
    });
  }

  return { laptopPOST, uploadPUT, uploadPOST };
}
