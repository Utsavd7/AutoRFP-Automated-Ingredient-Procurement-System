import {
  MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES,
  MAX_PHOTO_TRANSFER_IMAGES,
  PHOTO_TRANSFER_TTL_MS,
  type PhotoTransferManifest,
} from '@/lib/menu/photo-transfer-contract';
import {
  createNetlifyPhotoTransferStore,
  createPhotoTransferStoreAdapter,
} from '@/lib/menu/photo-transfer-store';
import {
  derivePhotoTransferExpiryIndexKey,
  derivePhotoTransferFileKey,
  derivePhotoTransferManifestKey,
} from '@/lib/menu/photo-transfer';
import { getStore } from '@netlify/blobs';

jest.mock('@netlify/blobs', () => ({ getStore: jest.fn() }));

const NOW = Date.UTC(2026, 8, 1, 10, 0, 0);
const SESSION_ID = 'nHEjYxeJ_2yZYNQnXaVrpIoyprKsf68V';

function manifest(overrides: Partial<PhotoTransferManifest> = {}): PhotoTransferManifest {
  return {
    sessionId: SESSION_ID,
    workspaceId: 'workspace-123',
    expiresAt: NOW + PHOTO_TRANSFER_TTL_MS,
    files: [{
      index: 0,
      name: 'menu.jpg',
      type: 'image/jpeg',
      size: 3,
      encryptedSize: 3 + MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES,
      iv: Buffer.alloc(12, 1).toString('base64url'),
    }],
    ...overrides,
  };
}

function rawStore() {
  return {
    get: jest.fn(),
    getWithMetadata: jest.fn(),
    set: jest.fn().mockResolvedValue({ modified: true, etag: 'ciphertext-etag' }),
    setJSON: jest.fn().mockResolvedValue({ modified: true, etag: 'manifest-etag' }),
    delete: jest.fn().mockResolvedValue(undefined),
    list: jest.fn(),
  };
}

function onePage(blobs: Array<{ key: string; etag: string }>) {
  const next = jest.fn()
    .mockResolvedValueOnce({ done: false, value: { blobs, directories: [] } })
    .mockRejectedValue(new Error('A second provider page must not be requested.'));
  return {
    iterable: {
      [Symbol.asyncIterator]: () => ({ next }),
    },
    next,
  };
}

function expiryIndexValue(value: PhotoTransferManifest) {
  return {
    sessionId: value.sessionId,
    expiresAt: value.expiresAt,
  };
}

describe('photo transfer Netlify Blobs adapter', () => {
  it('opens one private site-wide store with strong consistency only at runtime', () => {
    const raw = rawStore();
    jest.mocked(getStore).mockReturnValue(raw as never);

    expect(getStore).not.toHaveBeenCalled();
    createNetlifyPhotoTransferStore();

    expect(getStore).toHaveBeenCalledWith({
      name: 'private-photo-transfers',
      consistency: 'strong',
    });
  });

  it('creates the expiry index before the manifest and uses immutable ciphertext writes', async () => {
    const raw = rawStore();
    raw.setJSON
      .mockResolvedValueOnce({ modified: true, etag: 'index-etag' })
      .mockResolvedValueOnce({ modified: true, etag: 'manifest-v1' });
    const store = createPhotoTransferStoreAdapter(raw);
    const value = manifest();
    const ciphertext = new Uint8Array([1, 2, 3]).buffer;

    await expect(store.setManifest(SESSION_ID, value, { onlyIfNew: true }))
      .resolves.toEqual({ etag: 'manifest-v1' });
    await store.putCiphertext(SESSION_ID, 0, ciphertext);

    const expiryKey = derivePhotoTransferExpiryIndexKey(SESSION_ID, value.expiresAt);
    expect(raw.setJSON).toHaveBeenNthCalledWith(
      1,
      expiryKey,
      expiryIndexValue(value),
      { onlyIfNew: true },
    );
    expect(raw.setJSON).toHaveBeenNthCalledWith(
      2,
      derivePhotoTransferManifestKey(SESSION_ID),
      value,
      { onlyIfNew: true },
    );
    expect(raw.set).toHaveBeenCalledWith(
      derivePhotoTransferFileKey(SESSION_ID, 0),
      ciphertext,
      { onlyIfNew: true },
    );
  });

  it('exposes manifest ETags and rejects stale compare-and-set transitions', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    const value = manifest();
    raw.getWithMetadata.mockResolvedValueOnce({
      data: value,
      etag: 'manifest-v1',
      metadata: {},
    });

    await expect(store.getManifest(SESSION_ID)).resolves.toEqual({
      manifest: value,
      etag: 'manifest-v1',
    });

    raw.setJSON.mockResolvedValueOnce({ modified: true, etag: 'manifest-v2' });
    await expect(store.setManifest(SESSION_ID, value, { onlyIfMatch: 'manifest-v1' }))
      .resolves.toEqual({ etag: 'manifest-v2' });
    expect(raw.setJSON).toHaveBeenLastCalledWith(
      derivePhotoTransferManifestKey(SESSION_ID),
      value,
      { onlyIfMatch: 'manifest-v1' },
    );

    raw.setJSON.mockResolvedValueOnce({ modified: false });
    await expect(store.setManifest(SESSION_ID, value, { onlyIfMatch: 'manifest-v1' }))
      .rejects.toThrow('Photo transfer manifest write conflict.');
  });

  it('validates stored manifests and never returns untrusted data', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    raw.getWithMetadata.mockResolvedValueOnce({
      data: { ...manifest(), encryptionKey: 'leak' },
      etag: 'manifest-v1',
      metadata: {},
    });

    await expect(store.getManifest(SESSION_ID)).rejects.toThrow('Invalid photo transfer manifest.');
  });

  it('keeps the manifest discoverable after a ciphertext deletion failure and supports retry', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    const value = manifest();
    raw.getWithMetadata.mockResolvedValue({
      data: value,
      etag: 'manifest-v1',
      metadata: {},
    });
    raw.delete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('ciphertext delete failed'));

    await expect(store.deleteSession(SESSION_ID)).rejects.toThrow('ciphertext delete failed');
    expect(raw.delete).toHaveBeenNthCalledWith(1, derivePhotoTransferFileKey(SESSION_ID, 0));
    expect(raw.delete).toHaveBeenNthCalledWith(2, derivePhotoTransferFileKey(SESSION_ID, 1));
    expect(raw.delete).not.toHaveBeenCalledWith(derivePhotoTransferManifestKey(SESSION_ID));

    raw.delete.mockClear();
    raw.delete.mockResolvedValue(undefined);
    await store.deleteSession(SESSION_ID);

    const deletedKeys = raw.delete.mock.calls.map(([key]) => key);
    expect(deletedKeys.slice(0, MAX_PHOTO_TRANSFER_IMAGES)).toEqual(
      Array.from({ length: MAX_PHOTO_TRANSFER_IMAGES }, (_, index) => (
        derivePhotoTransferFileKey(SESSION_ID, index)
      )),
    );
    expect(deletedKeys.at(-2)).toBe(derivePhotoTransferManifestKey(SESSION_ID));
    expect(deletedKeys.at(-1)).toBe(
      derivePhotoTransferExpiryIndexKey(SESSION_ID, value.expiresAt),
    );
  });

  it('uses one expiry-index page, removes stale indexes, and stops at the future', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    const stale = manifest({
      sessionId: Buffer.alloc(24, 2).toString('base64url'),
      expiresAt: NOW - 2,
    });
    const expired = manifest({ expiresAt: NOW - 1 });
    const future = manifest({
      sessionId: Buffer.alloc(24, 3).toString('base64url'),
      expiresAt: NOW + 1,
    });
    const indexValues = new Map([
      [derivePhotoTransferExpiryIndexKey(stale.sessionId, stale.expiresAt), expiryIndexValue(stale)],
      [derivePhotoTransferExpiryIndexKey(expired.sessionId, expired.expiresAt), expiryIndexValue(expired)],
      [derivePhotoTransferExpiryIndexKey(future.sessionId, future.expiresAt), expiryIndexValue(future)],
    ]);
    const page = onePage([...indexValues.keys()].sort().map((key) => ({ key, etag: 'index-etag' })));
    raw.list.mockReturnValue(page.iterable);
    raw.get.mockImplementation((key: string) => Promise.resolve(indexValues.get(key)));
    raw.getWithMetadata
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ data: expired, etag: 'manifest-v1', metadata: {} });

    await expect(store.listExpiredSessionCandidates(NOW, 10)).resolves.toEqual([{
      manifest: expired,
      etag: 'manifest-v1',
    }]);

    expect(raw.list).toHaveBeenCalledWith({ prefix: 'expiry/', paginate: true });
    expect(page.next).toHaveBeenCalledTimes(1);
    expect(raw.get).toHaveBeenCalledTimes(2);
    expect(raw.getWithMetadata).toHaveBeenCalledTimes(2);
    expect(raw.delete).toHaveBeenCalledWith(
      derivePhotoTransferExpiryIndexKey(stale.sessionId, stale.expiresAt),
    );
  });

  it('does not delete an expiry index whose private value cannot be validated', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    const value = manifest({ expiresAt: NOW - 1 });
    const key = derivePhotoTransferExpiryIndexKey(value.sessionId, value.expiresAt);
    const page = onePage([{ key, etag: 'index-etag' }]);
    raw.list.mockReturnValue(page.iterable);
    raw.get.mockResolvedValue({
      ...expiryIndexValue(value),
      token: 'untrusted-extra-field',
    });

    await expect(store.listExpiredSessionCandidates(NOW, 10)).resolves.toEqual([]);
    expect(raw.delete).not.toHaveBeenCalled();
    expect(raw.getWithMetadata).not.toHaveBeenCalled();
  });

  it('bounds expiry-index GET work even when the first page contains many stale sessions', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    const stale = Array.from({ length: 100 }, (_, index) => manifest({
      sessionId: Buffer.alloc(24, index + 10).toString('base64url'),
      expiresAt: NOW - 1_000 + index,
    }));
    const indexValues = new Map(stale.map((value) => [
      derivePhotoTransferExpiryIndexKey(value.sessionId, value.expiresAt),
      expiryIndexValue(value),
    ]));
    const page = onePage([...indexValues.keys()].sort().map((key) => ({ key, etag: 'index-etag' })));
    raw.list.mockReturnValue(page.iterable);
    raw.get.mockImplementation((key: string) => Promise.resolve(indexValues.get(key)));
    raw.getWithMetadata.mockResolvedValue(null);

    await expect(store.listExpiredSessionCandidates(NOW, 2)).resolves.toEqual([]);

    expect(page.next).toHaveBeenCalledTimes(1);
    expect(raw.get.mock.calls.length).toBeLessThanOrEqual(8);
    expect(raw.getWithMetadata.mock.calls.length).toBeLessThanOrEqual(8);
  });
});
