import {
  MAX_PHOTO_TRANSFER_IMAGE_BYTES,
  MAX_PHOTO_TRANSFER_IMAGES,
  PHOTO_TRANSFER_TTL_MS,
  encodePhotoTransferMetadataHeader,
  type PhotoTransferFileMetadata,
  type PhotoTransferManifest,
} from '@/lib/menu/photo-transfer-contract';
import { createPhotoTransferRouteHandlers } from '@/lib/menu/photo-transfer-http';
import type {
  PhotoTransferManifestWriteCondition,
  PhotoTransferStore,
  StoredPhotoTransferManifest,
} from '@/lib/menu/photo-transfer-store';
import {
  issuePhotoTransferToken,
  verifyPhotoTransferToken,
} from '@/lib/menu/photo-transfer';

const NOW = 1_800_000_000_000;
const SECRET = 'test-photo-transfer-secret-with-at-least-32-characters';
const ORIGIN = 'https://quoteplate.example';

const user = {
  id: 'user-a',
  tenantId: 'tenant-a',
  accountState: 'ACTIVE',
  isActive: true,
};
const context = { tenant: { id: 'tenant-a' }, user };

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

function jsonRequest(
  body: unknown,
  options: {
    url?: string;
    origin?: string;
    contentType?: string;
    authorization?: string;
    rawBody?: string;
    contentLength?: string;
  } = {},
) {
  const rawBody = options.rawBody ?? JSON.stringify(body);
  return new Request(options.url ?? `${ORIGIN}/api/menu-photo-transfer`, {
    method: 'POST',
    headers: {
      'content-type': options.contentType ?? 'application/json',
      origin: options.origin ?? ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...(options.authorization ? { authorization: options.authorization } : {}),
      ...(options.contentLength ? { 'content-length': options.contentLength } : {}),
    },
    body: rawBody,
  });
}

function metadata(index: number, size = 3): PhotoTransferFileMetadata {
  return {
    index,
    name: `photo-${index}.jpg`,
    type: 'image/jpeg',
    size,
    encryptedSize: size + 16,
    iv: 'AAAAAAAAAAAAAAAA',
  };
}

function unsafeMetadataHeader(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function putRequest(
  token: string | null,
  file: PhotoTransferFileMetadata,
  body: Uint8Array,
  options: {
    origin?: string;
    contentType?: string;
    metadataHeader?: string;
    contentLength?: string;
  } = {},
) {
  return new Request(`${ORIGIN}/api/menu-photo-transfer/upload`, {
    method: 'PUT',
    headers: {
      'content-type': options.contentType ?? 'application/octet-stream',
      origin: options.origin ?? ORIGIN,
      'sec-fetch-site': 'same-origin',
      'x-photo-transfer-metadata': options.metadataHeader
        ?? encodePhotoTransferMetadataHeader(file),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.contentLength ? { 'content-length': options.contentLength } : {}),
    },
    body: new Uint8Array(body).buffer,
  });
}

function completeRequest(token: string, body: unknown = { action: 'complete' }) {
  return jsonRequest(body, {
    url: `${ORIGIN}/api/menu-photo-transfer/upload`,
    authorization: `Bearer ${token}`,
  });
}

function cloneManifest(manifest: PhotoTransferManifest): PhotoTransferManifest {
  return structuredClone(manifest);
}

class MemoryPhotoTransferStore implements PhotoTransferStore {
  private etagSequence = 0;

  readonly manifests = new Map<string, StoredPhotoTransferManifest>();
  readonly ciphertext = new Map<string, ArrayBuffer>();
  readonly listExpiredSessionCandidates = jest.fn(
    async (now: number, limit = 100): Promise<StoredPhotoTransferManifest[]> =>
      [...this.manifests.values()]
        .filter(({ manifest }) => manifest.expiresAt <= now)
        .slice(0, limit)
        .map(({ manifest, etag }) => ({ manifest: cloneManifest(manifest), etag })),
  );
  readonly deleteSession = jest.fn(async (sessionId: string) => {
    for (let index = 0; index < MAX_PHOTO_TRANSFER_IMAGES; index += 1) {
      this.ciphertext.delete(`${sessionId}:${index}`);
    }
    this.manifests.delete(sessionId);
  });
  readonly getManifest = jest.fn(async (sessionId: string) => {
    const value = this.manifests.get(sessionId);
    return value
      ? { manifest: cloneManifest(value.manifest), etag: value.etag }
      : null;
  });
  readonly setManifest = jest.fn(async (
    sessionId: string,
    manifest: PhotoTransferManifest,
    condition: PhotoTransferManifestWriteCondition,
  ): Promise<{ etag: string }> => {
    const current = this.manifests.get(sessionId);
    if ('onlyIfNew' in condition) {
      if (current) throw new Error('Photo transfer manifest write conflict.');
    } else if (!current || current.etag !== condition.onlyIfMatch) {
      throw new Error('Photo transfer manifest write conflict.');
    }
    this.etagSequence += 1;
    const etag = `etag-${this.etagSequence}`;
    this.manifests.set(sessionId, { manifest: cloneManifest(manifest), etag });
    return { etag };
  });
  readonly putCiphertext = jest.fn(async (
    sessionId: string,
    index: number,
    ciphertext: ArrayBuffer,
  ) => {
    const key = `${sessionId}:${index}`;
    if (this.ciphertext.has(key)) {
      throw new Error('Photo transfer ciphertext already exists.');
    }
    this.ciphertext.set(key, ciphertext.slice(0));
  });
  readonly getCiphertext = jest.fn(async (sessionId: string, index: number) =>
    this.ciphertext.get(`${sessionId}:${index}`)?.slice(0) ?? null);
  readonly deleteCiphertext = jest.fn(async (sessionId: string, index: number) => {
    this.ciphertext.delete(`${sessionId}:${index}`);
  });

  seed(manifest: PhotoTransferManifest, etag = `seed-${this.manifests.size}`) {
    this.manifests.set(manifest.sessionId, { manifest: cloneManifest(manifest), etag });
  }
}

function setup(overrides: Partial<{
  accountContext: () => Promise<unknown>;
  storeFactory: () => PhotoTransferStore;
  getSecret: () => string | undefined;
  now: () => number;
  rateLimit: (input: unknown) => Promise<{
    allowed: boolean;
    retryAfterSeconds: number;
  }>;
}> = {}) {
  const store = new MemoryPhotoTransferStore();
  const dependencies = {
    accountContext: jest.fn().mockResolvedValue(context),
    storeFactory: jest.fn(() => store),
    getSecret: jest.fn(() => SECRET),
    now: jest.fn(() => NOW),
    rateLimit: jest.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 15 * 60,
    }),
    ...overrides,
  };
  return {
    store,
    dependencies,
    handlers: createPhotoTransferRouteHandlers(dependencies as never),
  };
}

function tokenAndManifest(
  store: MemoryPhotoTransferStore,
  options: {
    workspaceId?: string;
    issueNow?: number;
    manifestExpiresAt?: number;
    files?: PhotoTransferFileMetadata[];
    completedAt?: number;
  } = {},
) {
  const issued = issuePhotoTransferToken({
    workspaceId: options.workspaceId ?? 'tenant-a',
    secret: SECRET,
    now: options.issueNow ?? NOW,
  });
  const manifest: PhotoTransferManifest = {
    sessionId: issued.sessionId,
    workspaceId: options.workspaceId ?? 'tenant-a',
    expiresAt: options.manifestExpiresAt ?? issued.expiresAt,
    files: options.files ?? [],
    ...(options.completedAt === undefined ? {} : { completedAt: options.completedAt }),
  };
  store.seed(manifest);
  return { ...issued, manifest };
}

describe('menu photo transfer API', () => {
  it('rejects an unsafe or unauthenticated create before touching storage', async () => {
    const accountContext = jest.fn().mockResolvedValue(null);
    const storeFactory = jest.fn(() => new MemoryPhotoTransferStore());
    const handlers = createPhotoTransferRouteHandlers({
      accountContext: accountContext as never,
      storeFactory,
      getSecret: () => SECRET,
      now: () => NOW,
      rateLimit: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 15 * 60,
      }),
    });

    const unsafe = await handlers.laptopPOST(jsonRequest(
      { action: 'create' },
      { origin: 'https://evil.example' },
    ));
    expect(unsafe.status).toBe(403);
    expect(accountContext).not.toHaveBeenCalled();
    expect(storeFactory).not.toHaveBeenCalled();
    expectPrivate(unsafe);

    const unauthorized = await handlers.laptopPOST(jsonRequest({ action: 'create' }));
    expect(unauthorized.status).toBe(401);
    expect(storeFactory).not.toHaveBeenCalled();
    expectPrivate(unauthorized);
  });

  it('rejects wrong media, malformed JSON, oversized JSON, and inexact actions before auth', async () => {
    const accountContext = jest.fn().mockResolvedValue(context);
    const { handlers } = setup({ accountContext });

    const responses = await Promise.all([
      handlers.laptopPOST(jsonRequest({ action: 'create' }, { contentType: 'text/plain' })),
      handlers.laptopPOST(jsonRequest(null, { rawBody: '{' })),
      handlers.laptopPOST(jsonRequest({ action: 'create' }, { contentLength: '4097' })),
      handlers.laptopPOST(jsonRequest({ action: 'create', extra: true })),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([415, 400, 413, 400]);
    responses.forEach(expectPrivate);
    expect(accountContext).not.toHaveBeenCalled();
  });

  it('creates an empty transfer and cleans up at most one expired session', async () => {
    const { handlers, store } = setup();
    for (let index = 0; index < 25; index += 1) {
      const issued = issuePhotoTransferToken({
        workspaceId: 'tenant-a',
        secret: SECRET,
        now: NOW - PHOTO_TRANSFER_TTL_MS - index - 1,
      });
      store.seed({
        sessionId: issued.sessionId,
        workspaceId: 'tenant-a',
        expiresAt: issued.expiresAt,
        files: [],
      });
    }

    const response = await handlers.laptopPOST(jsonRequest({ action: 'create' }));

    expect(response.status).toBe(201);
    expectPrivate(response);
    const body = await response.json();
    expect(body).toEqual({
      token: expect.any(String),
      expiresAt: NOW + PHOTO_TRANSFER_TTL_MS,
    });
    expect(store.listExpiredSessionCandidates).toHaveBeenCalledWith(NOW, 1);
    expect(store.deleteSession).toHaveBeenCalledTimes(1);
    const payload = verifyPhotoTransferToken({ token: body.token, secret: SECRET, now: NOW });
    expect(store.manifests.get(payload.sessionId)?.manifest).toEqual({
      sessionId: payload.sessionId,
      workspaceId: 'tenant-a',
      expiresAt: body.expiresAt,
      files: [],
    });
    expect(store.setManifest).toHaveBeenLastCalledWith(
      payload.sessionId,
      expect.objectContaining({ files: [] }),
      { onlyIfNew: true },
    );
  });

  it('keeps create available when best-effort cleanup fails', async () => {
    const { handlers, store } = setup();
    store.listExpiredSessionCandidates.mockRejectedValueOnce(new Error('provider detail'));

    const response = await handlers.laptopPOST(jsonRequest({ action: 'create' }));

    expect(response.status).toBe(201);
    expectPrivate(response);
  });

  it('rate-limits authenticated creation before Blob cleanup or creation', async () => {
    const rateLimit = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 321,
    });
    const storeFactory = jest.fn(() => new MemoryPhotoTransferStore());
    const { handlers } = setup({ rateLimit, storeFactory });

    const response = await handlers.laptopPOST(jsonRequest({ action: 'create' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('321');
    expectPrivate(response);
    expect(rateLimit).toHaveBeenCalledWith({
      operation: 'create',
      workspaceId: 'tenant-a',
      userId: 'user-a',
      now: new Date(NOW),
    });
    expect(storeFactory).not.toHaveBeenCalled();
  });

  it('uses one generic unavailable response for invalid, expired, missing, and wrong-workspace transfers', async () => {
    const { handlers, store } = setup();
    const validMissing = issuePhotoTransferToken({
      workspaceId: 'tenant-a',
      secret: SECRET,
      now: NOW,
    });
    const expired = issuePhotoTransferToken({
      workspaceId: 'tenant-a',
      secret: SECRET,
      now: NOW - PHOTO_TRANSFER_TTL_MS,
    });
    const mismatch = tokenAndManifest(store, { workspaceId: 'tenant-b' });
    const requests = [
      'invalid-token',
      `${validMissing.token.slice(0, -1)}x`,
      expired.token,
      validMissing.token,
      mismatch.token,
    ].map((token) => handlers.laptopPOST(jsonRequest({ action: 'status', token })));

    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map(({ status }) => status)).toEqual([410, 410, 410, 410, 410]);
    expect(bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0]))).toBe(true);
    responses.forEach(expectPrivate);
  });

  it('deletes an expired manifest best-effort and returns the generic unavailable response', async () => {
    const { handlers, store } = setup();
    const issued = tokenAndManifest(store, { issueNow: NOW - PHOTO_TRANSFER_TTL_MS });

    const response = await handlers.laptopPOST(jsonRequest({
      action: 'status',
      token: issued.token,
    }));

    expect(response.status).toBe(410);
    expect(store.deleteSession).toHaveBeenCalledWith(issued.sessionId);
  });

  it('rejects unsafe, wrong-media, and missing-bearer PUTs before storage', async () => {
    const storeFactory = jest.fn(() => new MemoryPhotoTransferStore());
    const { handlers } = setup({ storeFactory });
    const file = metadata(0);
    const body = new Uint8Array(file.encryptedSize);

    const unsafe = await handlers.uploadPUT(putRequest('token', file, body, {
      origin: 'https://evil.example',
    }));
    const wrongMedia = await handlers.uploadPUT(putRequest('token', file, body, {
      contentType: 'image/jpeg',
    }));
    const missingBearer = await handlers.uploadPUT(putRequest(null, file, body));

    expect([unsafe.status, wrongMedia.status, missingBearer.status]).toEqual([403, 415, 410]);
    expect(storeFactory).not.toHaveBeenCalled();
    [unsafe, wrongMedia, missingBearer].forEach(expectPrivate);
  });

  it('rate-limits phone upload and completion after token verification but before Blob or body work', async () => {
    const rateLimit = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 87,
    });
    const storeFactory = jest.fn(() => new MemoryPhotoTransferStore());
    const { handlers } = setup({ rateLimit, storeFactory });
    const issued = issuePhotoTransferToken({
      workspaceId: 'tenant-a',
      secret: SECRET,
      now: NOW,
    });
    const uploadRequest = putRequest(
      issued.token,
      metadata(0),
      new Uint8Array(19),
    );
    const bodyReader = jest.spyOn(uploadRequest.body!, 'getReader');

    const upload = await handlers.uploadPUT(uploadRequest);
    const complete = await handlers.uploadPOST(completeRequest(issued.token));

    expect([upload.status, complete.status]).toEqual([429, 429]);
    expect(upload.headers.get('retry-after')).toBe('87');
    expect(complete.headers.get('retry-after')).toBe('87');
    expect(rateLimit).toHaveBeenCalledTimes(2);
    expect(rateLimit).toHaveBeenNthCalledWith(1, {
      operation: 'upload',
      sessionId: issued.sessionId,
      now: new Date(NOW),
    });
    expect(rateLimit).toHaveBeenNthCalledWith(2, {
      operation: 'upload',
      sessionId: issued.sessionId,
      now: new Date(NOW),
    });
    expect(storeFactory).not.toHaveBeenCalled();
    expect(bodyReader).not.toHaveBeenCalled();
    [upload, complete].forEach(expectPrivate);
  });

  it.each([
    ['malformed encoding', '***', 400],
    ['wrong type', unsafeMetadataHeader({ ...metadata(0), type: 'image/gif' }), 422],
    ['oversized original', unsafeMetadataHeader({
      ...metadata(0),
      size: MAX_PHOTO_TRANSFER_IMAGE_BYTES + 1,
      encryptedSize: MAX_PHOTO_TRANSFER_IMAGE_BYTES + 17,
    }), 422],
    ['wrong AES-GCM overhead', unsafeMetadataHeader({ ...metadata(0), encryptedSize: 3 }), 422],
    ['extra field', unsafeMetadataHeader({ ...metadata(0), privateKey: 'nope' }), 422],
  ])('rejects %s upload metadata', async (_label, metadataHeader, expectedStatus) => {
    const { handlers, store } = setup();
    const issued = tokenAndManifest(store);

    const response = await handlers.uploadPUT(putRequest(
      issued.token,
      metadata(0),
      new Uint8Array(19),
      { metadataHeader },
    ));

    expect(response.status).toBe(expectedStatus);
    expect(store.putCiphertext).not.toHaveBeenCalled();
    expectPrivate(response);
  });

  it('enforces exact body length, bounded bodies, sequential indices, and the ten-file maximum', async () => {
    const { handlers, store } = setup();
    const first = tokenAndManifest(store);

    const shortBody = await handlers.uploadPUT(putRequest(
      first.token,
      metadata(0),
      new Uint8Array(18),
    ));
    const oversizedBody = await handlers.uploadPUT(putRequest(
      first.token,
      metadata(0),
      new Uint8Array(19),
      { contentLength: String(MAX_PHOTO_TRANSFER_IMAGE_BYTES + 17) },
    ));
    const skippedIndex = await handlers.uploadPUT(putRequest(
      first.token,
      metadata(1),
      new Uint8Array(19),
    ));

    const tenFiles = Array.from({ length: MAX_PHOTO_TRANSFER_IMAGES }, (_, index) => metadata(index));
    const full = tokenAndManifest(store, { files: tenFiles });
    const maximum = await handlers.uploadPUT(putRequest(
      full.token,
      metadata(9),
      new Uint8Array(19),
    ));

    expect([shortBody.status, oversizedBody.status, skippedIndex.status, maximum.status])
      .toEqual([422, 413, 409, 409]);
    [shortBody, oversizedBody, skippedIndex, maximum].forEach(expectPrivate);
  });

  it('runs the two-file create, upload, complete, status, download, and receipt lifecycle', async () => {
    const { handlers, store } = setup();
    const created = await handlers.laptopPOST(jsonRequest({ action: 'create' }));
    const creation = await created.json() as { token: string; expiresAt: number };
    const first = metadata(0, 3);
    const second = { ...metadata(1, 4), name: 'second.png', type: 'image/png' as const };
    const firstCiphertext = Uint8Array.from({ length: first.encryptedSize }, (_, index) => index);
    const secondCiphertext = Uint8Array.from({ length: second.encryptedSize }, (_, index) => 255 - index);

    const firstUpload = await handlers.uploadPUT(putRequest(
      creation.token,
      first,
      firstCiphertext,
    ));
    const secondUpload = await handlers.uploadPUT(putRequest(
      creation.token,
      second,
      secondCiphertext,
    ));
    const completed = await handlers.uploadPOST(completeRequest(creation.token));
    const status = await handlers.laptopPOST(jsonRequest({
      action: 'status',
      token: creation.token,
    }));
    const statusBody = await status.json();
    const firstDownload = await handlers.laptopPOST(jsonRequest({
      action: 'download',
      token: creation.token,
      index: 0,
    }));
    const secondDownload = await handlers.laptopPOST(jsonRequest({
      action: 'download',
      token: creation.token,
      index: 1,
    }));
    const payload = verifyPhotoTransferToken({ token: creation.token, secret: SECRET, now: NOW });
    const receipt = await handlers.laptopPOST(jsonRequest({
      action: 'receipt',
      token: creation.token,
    }));
    const afterReceipt = await handlers.laptopPOST(jsonRequest({
      action: 'status',
      token: creation.token,
    }));

    expect([created.status, firstUpload.status, secondUpload.status, completed.status])
      .toEqual([201, 201, 201, 200]);
    expect(status.status).toBe(200);
    expect(statusBody).toEqual({
      status: 'complete',
      expiresAt: creation.expiresAt,
      files: [first, second],
    });
    expect(JSON.stringify(statusBody)).not.toMatch(/session|workspace|etag|key/i);
    expect(firstDownload.status).toBe(200);
    expect(firstDownload.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await firstDownload.arrayBuffer())).toEqual(firstCiphertext);
    expect(new Uint8Array(await secondDownload.arrayBuffer())).toEqual(secondCiphertext);
    expect(receipt.status).toBe(204);
    expect(store.deleteSession).toHaveBeenCalledWith(payload.sessionId);
    expect(store.ciphertext.size).toBe(0);
    expect(afterReceipt.status).toBe(410);
    [created, firstUpload, secondUpload, completed, status, firstDownload, secondDownload, receipt, afterReceipt]
      .forEach(expectPrivate);
  });

  it('rolls back owned ciphertext when manifest CAS loses a race', async () => {
    const { handlers, store } = setup();
    const issued = tokenAndManifest(store);
    store.setManifest.mockRejectedValueOnce(new Error('Photo transfer manifest write conflict.'));

    const response = await handlers.uploadPUT(putRequest(
      issued.token,
      metadata(0),
      new Uint8Array(19),
    ));

    expect(response.status).toBe(409);
    expect(store.putCiphertext).toHaveBeenCalledTimes(1);
    expect(store.deleteCiphertext).toHaveBeenCalledWith(issued.sessionId, 0);
    expect(store.ciphertext.has(`${issued.sessionId}:0`)).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      status: 409,
      detail: expect.stringMatching(/retry/i),
    });
  });

  it('keeps ciphertext and succeeds when a timed-out manifest write actually committed', async () => {
    const { handlers, store } = setup();
    const issued = tokenAndManifest(store);
    const file = metadata(0);
    store.setManifest.mockImplementationOnce(async (sessionId, manifest) => {
      store.seed(manifest, 'committed-etag');
      throw new Error(`timeout after committing ${sessionId}`);
    });

    const response = await handlers.uploadPUT(putRequest(
      issued.token,
      file,
      new Uint8Array(file.encryptedSize),
    ));

    expect(response.status).toBe(201);
    expect(store.getManifest).toHaveBeenCalledTimes(2);
    expect(store.deleteCiphertext).not.toHaveBeenCalled();
    expect(store.ciphertext.has(`${issued.sessionId}:0`)).toBe(true);
  });

  it('deletes owned ciphertext when a failed manifest write is definitively uncommitted', async () => {
    const { handlers, store } = setup();
    const issued = tokenAndManifest(store);
    store.setManifest.mockRejectedValueOnce(new Error('provider timeout'));

    const response = await handlers.uploadPUT(putRequest(
      issued.token,
      metadata(0),
      new Uint8Array(19),
    ));

    expect(response.status).toBe(503);
    expect(store.getManifest).toHaveBeenCalledTimes(2);
    expect(store.deleteCiphertext).toHaveBeenCalledWith(issued.sessionId, 0);
    expect(store.ciphertext.has(`${issued.sessionId}:0`)).toBe(false);
  });

  it('keeps possibly committed ciphertext when manifest reconciliation is unreadable', async () => {
    const { handlers, store } = setup();
    const issued = tokenAndManifest(store);
    const initial = store.manifests.get(issued.sessionId)!;
    store.getManifest
      .mockResolvedValueOnce({
        manifest: cloneManifest(initial.manifest),
        etag: initial.etag,
      })
      .mockRejectedValueOnce(new Error('reconciliation unavailable'));
    store.setManifest.mockRejectedValueOnce(new Error('provider timeout'));

    const response = await handlers.uploadPUT(putRequest(
      issued.token,
      metadata(0),
      new Uint8Array(19),
    ));

    expect(response.status).toBe(503);
    expect(store.getManifest).toHaveBeenCalledTimes(2);
    expect(store.deleteCiphertext).not.toHaveBeenCalled();
    expect(store.ciphertext.has(`${issued.sessionId}:0`)).toBe(true);
  });

  it('makes completion and a valid current-tenant missing receipt idempotent', async () => {
    const { handlers, store } = setup();
    const completedAt = NOW - 1;
    const issued = tokenAndManifest(store, { files: [metadata(0)], completedAt });

    const first = await handlers.uploadPOST(completeRequest(issued.token));
    expect(first.status).toBe(200);
    expect(store.setManifest).not.toHaveBeenCalled();

    store.manifests.delete(issued.sessionId);
    const receipt = await handlers.laptopPOST(jsonRequest({
      action: 'receipt',
      token: issued.token,
    }));
    expect(receipt.status).toBe(204);
    expectPrivate(receipt);
  });

  it('rejects completion without files and returns a retryable conflict for stale completion CAS', async () => {
    const { handlers, store } = setup();
    const empty = tokenAndManifest(store);
    const emptyResponse = await handlers.uploadPOST(completeRequest(empty.token));

    const invalidCompleted = tokenAndManifest(store, { completedAt: NOW - 1 });
    const invalidCompletedResponse = await handlers.uploadPOST(
      completeRequest(invalidCompleted.token),
    );

    const ready = tokenAndManifest(store, { files: [metadata(0)] });
    store.setManifest.mockRejectedValueOnce(new Error('Photo transfer manifest write conflict.'));
    const staleResponse = await handlers.uploadPOST(completeRequest(ready.token));

    expect(emptyResponse.status).toBe(422);
    expect(invalidCompletedResponse.status).toBe(422);
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      status: 409,
      detail: expect.stringMatching(/retry/i),
    });
  });

  it('sanitizes signing and storage failures and gives the laptop-upload fallback', async () => {
    const providerDetail = `${SECRET}: provider-account-id`;
    const failingStore = new MemoryPhotoTransferStore();
    failingStore.getManifest.mockRejectedValueOnce(new Error(providerDetail));
    const { handlers } = setup({ storeFactory: () => failingStore });
    const issued = issuePhotoTransferToken({ workspaceId: 'tenant-a', secret: SECRET, now: NOW });

    const storageFailure = await handlers.laptopPOST(jsonRequest({
      action: 'status',
      token: issued.token,
    }));
    const secretFailure = await createPhotoTransferRouteHandlers({
      accountContext: jest.fn().mockResolvedValue(context) as never,
      storeFactory: () => failingStore,
      getSecret: () => 'too-short',
      now: () => NOW,
      rateLimit: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 15 * 60,
      }),
    }).laptopPOST(jsonRequest({ action: 'create' }));

    expect(storageFailure.status).toBe(503);
    expect(secretFailure.status).toBe(503);
    for (const response of [storageFailure, secretFailure]) {
      expectPrivate(response);
      const serialized = JSON.stringify(await response.json());
      expect(serialized).toMatch(/upload photos from this device/i);
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain('provider-account-id');
    }
  });
});
