import { getStore, type Store } from '@netlify/blobs';

import {
  parsePhotoTransferManifest,
  type PhotoTransferManifest,
} from './photo-transfer-contract';
import {
  derivePhotoTransferFileKey,
  derivePhotoTransferManifestKey,
  derivePhotoTransferSessionPrefix,
} from './photo-transfer';

const PHOTO_TRANSFER_STORE_NAME = 'private-photo-transfers';
const SESSION_LIST_PREFIX = 'sessions/';

type BlobStore = Pick<Store, 'delete' | 'get' | 'list' | 'set' | 'setJSON'>;

export type PhotoTransferSetManifestOptions = {
  onlyIfNew?: boolean;
};

export interface PhotoTransferStore {
  getManifest(sessionId: string): Promise<PhotoTransferManifest | null>;
  setManifest(
    sessionId: string,
    manifest: PhotoTransferManifest,
    options?: PhotoTransferSetManifestOptions,
  ): Promise<void>;
  putCiphertext(sessionId: string, index: number, ciphertext: ArrayBuffer): Promise<void>;
  getCiphertext(sessionId: string, index: number): Promise<ArrayBuffer | null>;
  deleteCiphertext(sessionId: string, index: number): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listExpiredSessionCandidates(now: number, limit?: number): Promise<PhotoTransferManifest[]>;
}

function ensureManifestMatchesSession(manifest: PhotoTransferManifest, sessionId: string) {
  if (manifest.sessionId !== sessionId) {
    throw new Error('Invalid photo transfer manifest.');
  }
}

function ensureConditionalWrite(result: { modified: boolean }, onlyIfNew: boolean) {
  if (onlyIfNew && !result.modified) {
    throw new Error('Photo transfer blob already exists.');
  }
}

export function createPhotoTransferStoreAdapter(blobStore: BlobStore): PhotoTransferStore {
  return {
    async getManifest(sessionId) {
      const stored = await blobStore.get(
        derivePhotoTransferManifestKey(sessionId),
        { type: 'json' },
      );
      if (stored === null) return null;
      const manifest = parsePhotoTransferManifest(stored);
      ensureManifestMatchesSession(manifest, sessionId);
      return manifest;
    },

    async setManifest(sessionId, manifest, options = {}) {
      const validated = parsePhotoTransferManifest(manifest);
      ensureManifestMatchesSession(validated, sessionId);
      const onlyIfNew = options.onlyIfNew === true;
      const result = await blobStore.setJSON(
        derivePhotoTransferManifestKey(sessionId),
        validated,
        onlyIfNew ? { onlyIfNew: true } : undefined,
      );
      ensureConditionalWrite(result, onlyIfNew);
    },

    async putCiphertext(sessionId, index, ciphertext) {
      const result = await blobStore.set(
        derivePhotoTransferFileKey(sessionId, index),
        ciphertext,
        { onlyIfNew: true },
      );
      ensureConditionalWrite(result, true);
    },

    async getCiphertext(sessionId, index) {
      return blobStore.get(
        derivePhotoTransferFileKey(sessionId, index),
        { type: 'arrayBuffer' },
      );
    },

    async deleteCiphertext(sessionId, index) {
      await blobStore.delete(derivePhotoTransferFileKey(sessionId, index));
    },

    async deleteSession(sessionId) {
      const prefix = `${derivePhotoTransferSessionPrefix(sessionId)}/`;
      const listed = await blobStore.list({ prefix, paginate: false });
      for (const blob of listed.blobs) {
        if (blob.key.startsWith(prefix)) await blobStore.delete(blob.key);
      }
    },

    async listExpiredSessionCandidates(now, limit = 100) {
      if (!Number.isSafeInteger(now) || now <= 0) {
        throw new Error('A valid current time is required.');
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('Invalid photo transfer candidate limit.');
      }

      const listed = await blobStore.list({
        prefix: SESSION_LIST_PREFIX,
        paginate: false,
      });
      const expired: PhotoTransferManifest[] = [];
      for (const blob of listed.blobs) {
        if (!blob.key.endsWith('/manifest.json')) continue;
        const stored = await blobStore.get(blob.key, { type: 'json' });
        if (stored === null) continue;
        const manifest = parsePhotoTransferManifest(stored);
        if (derivePhotoTransferManifestKey(manifest.sessionId) !== blob.key) {
          throw new Error('Invalid photo transfer manifest.');
        }
        if (manifest.expiresAt <= now) expired.push(manifest);
        if (expired.length === limit) break;
      }
      return expired;
    },
  };
}

export function createNetlifyPhotoTransferStore(): PhotoTransferStore {
  const blobStore = getStore({
    name: PHOTO_TRANSFER_STORE_NAME,
    consistency: 'strong',
  });
  return createPhotoTransferStoreAdapter(blobStore);
}
