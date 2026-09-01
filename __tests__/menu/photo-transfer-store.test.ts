import {
  MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES,
  PHOTO_TRANSFER_TTL_MS,
  type PhotoTransferManifest,
} from '@/lib/menu/photo-transfer-contract';
import {
  createNetlifyPhotoTransferStore,
  createPhotoTransferStoreAdapter,
} from '@/lib/menu/photo-transfer-store';
import {
  derivePhotoTransferFileKey,
  derivePhotoTransferManifestKey,
  derivePhotoTransferSessionPrefix,
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
    set: jest.fn().mockResolvedValue({ modified: true }),
    setJSON: jest.fn().mockResolvedValue({ modified: true }),
    delete: jest.fn().mockResolvedValue(undefined),
    list: jest.fn(),
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

  it('uses immutable writes for initial manifests and ciphertext files', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    const value = manifest();
    const ciphertext = new Uint8Array([1, 2, 3]).buffer;

    await store.setManifest(SESSION_ID, value, { onlyIfNew: true });
    await store.putCiphertext(SESSION_ID, 0, ciphertext);

    expect(raw.setJSON).toHaveBeenCalledWith(
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

  it('validates stored manifests and never returns untrusted data', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    raw.get.mockResolvedValueOnce({ ...manifest(), encryptionKey: 'leak' });

    await expect(store.getManifest(SESSION_ID)).rejects.toThrow('Invalid photo transfer manifest.');
  });

  it('lists valid expired candidates and deletes every opaque session blob', async () => {
    const raw = rawStore();
    const store = createPhotoTransferStoreAdapter(raw);
    const expired = manifest({ expiresAt: NOW - 1 });
    const active = manifest({
      sessionId: 'cN-lLeXLflXgy-kqr7p0OMgVU7Sb3ZjH',
      expiresAt: NOW + 1,
    });
    raw.list.mockResolvedValueOnce({
      blobs: [
        { key: derivePhotoTransferManifestKey(expired.sessionId) },
        { key: derivePhotoTransferManifestKey(active.sessionId) },
      ],
      directories: [],
    });
    raw.get.mockResolvedValueOnce(expired).mockResolvedValueOnce(active);

    await expect(store.listExpiredSessionCandidates(NOW, 10)).resolves.toEqual([expired]);

    const prefix = derivePhotoTransferSessionPrefix(SESSION_ID);
    raw.list.mockResolvedValueOnce({
      blobs: [
        { key: `${prefix}/manifest.json` },
        { key: `${prefix}/files/0.bin` },
      ],
      directories: [],
    });
    await store.deleteSession(SESSION_ID);

    expect(raw.delete).toHaveBeenCalledTimes(2);
    expect(raw.delete).toHaveBeenCalledWith(`${prefix}/manifest.json`);
    expect(raw.delete).toHaveBeenCalledWith(`${prefix}/files/0.bin`);
  });
});
