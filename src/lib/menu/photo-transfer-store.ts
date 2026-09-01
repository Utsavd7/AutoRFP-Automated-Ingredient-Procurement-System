import { getStore, type Store } from '@netlify/blobs';

import {
  MAX_PHOTO_TRANSFER_IMAGES,
  isPhotoTransferSessionId,
  parsePhotoTransferManifest,
  type PhotoTransferManifest,
} from './photo-transfer-contract';
import {
  derivePhotoTransferExpiryIndexKey,
  derivePhotoTransferFileKey,
  derivePhotoTransferManifestKey,
} from './photo-transfer';

const PHOTO_TRANSFER_STORE_NAME = 'private-photo-transfers';
const EXPIRY_INDEX_PREFIX = 'expiry/';
const EXPIRY_INDEX_PATTERN = /^expiry\/(\d{13})\/[a-f0-9]{64}\.json$/;
const EXPIRY_SCAN_MULTIPLIER = 4;
const MAX_EXPIRY_SCAN_ENTRIES = 1_000;

type BlobStore = Pick<
  Store,
  'delete' | 'get' | 'getWithMetadata' | 'list' | 'set' | 'setJSON'
>;

export type StoredPhotoTransferManifest = {
  manifest: PhotoTransferManifest;
  etag: string;
};

export type PhotoTransferManifestWriteCondition =
  | { onlyIfNew: true; onlyIfMatch?: never }
  | { onlyIfMatch: string; onlyIfNew?: never };

export interface PhotoTransferStore {
  getManifest(sessionId: string): Promise<StoredPhotoTransferManifest | null>;
  setManifest(
    sessionId: string,
    manifest: PhotoTransferManifest,
    condition: PhotoTransferManifestWriteCondition,
  ): Promise<{ etag: string }>;
  putCiphertext(sessionId: string, index: number, ciphertext: ArrayBuffer): Promise<void>;
  getCiphertext(sessionId: string, index: number): Promise<ArrayBuffer | null>;
  deleteCiphertext(sessionId: string, index: number): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listExpiredSessionCandidates(
    now: number,
    limit?: number,
  ): Promise<StoredPhotoTransferManifest[]>;
}

type ExpiryIndexValue = {
  sessionId: string;
  expiresAt: number;
};

function ensureManifestMatchesSession(manifest: PhotoTransferManifest, sessionId: string) {
  if (manifest.sessionId !== sessionId) {
    throw new Error('Invalid photo transfer manifest.');
  }
}

function validEtag(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function expiryTimestampFromKey(key: string) {
  const match = EXPIRY_INDEX_PATTERN.exec(key);
  if (match === null) return null;
  const expiresAt = Number(match[1]);
  return Number.isSafeInteger(expiresAt) && expiresAt > 0 ? expiresAt : null;
}

function parseExpiryIndexValue(stored: unknown, key: string): ExpiryIndexValue | null {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null;
  const value = stored as Record<string, unknown>;
  const keys = Object.keys(value);
  if (
    keys.length !== 2
    || !('sessionId' in value)
    || !('expiresAt' in value)
    || !isPhotoTransferSessionId(value.sessionId)
    || !Number.isSafeInteger(value.expiresAt)
  ) {
    return null;
  }

  const expiresAt = Number(value.expiresAt);
  if (
    expiryTimestampFromKey(key) !== expiresAt
    || derivePhotoTransferExpiryIndexKey(value.sessionId, expiresAt) !== key
  ) {
    return null;
  }
  return { sessionId: value.sessionId, expiresAt };
}

function parseWriteCondition(condition: PhotoTransferManifestWriteCondition) {
  const onlyIfNew = condition?.onlyIfNew === true;
  const onlyIfMatch = condition?.onlyIfMatch;
  if (onlyIfNew && onlyIfMatch === undefined) {
    return { onlyIfNew: true } as const;
  }
  if (!onlyIfNew && validEtag(onlyIfMatch)) {
    return { onlyIfMatch } as const;
  }
  throw new Error('A photo transfer manifest write condition is required.');
}

async function readManifest(
  blobStore: BlobStore,
  sessionId: string,
): Promise<StoredPhotoTransferManifest | null> {
  const stored = await blobStore.getWithMetadata(
    derivePhotoTransferManifestKey(sessionId),
    { type: 'json' },
  );
  if (stored === null) return null;
  const manifest = parsePhotoTransferManifest(stored.data);
  ensureManifestMatchesSession(manifest, sessionId);
  if (!validEtag(stored.etag)) {
    throw new Error('Photo transfer manifest is missing an ETag.');
  }
  return { manifest, etag: stored.etag };
}

async function ensureExpiryIndex(blobStore: BlobStore, manifest: PhotoTransferManifest) {
  const key = derivePhotoTransferExpiryIndexKey(manifest.sessionId, manifest.expiresAt);
  const value: ExpiryIndexValue = {
    sessionId: manifest.sessionId,
    expiresAt: manifest.expiresAt,
  };
  const result = await blobStore.setJSON(key, value, { onlyIfNew: true });
  if (result.modified) return;

  const existing = await blobStore.get(key, { type: 'json' });
  const parsed = parseExpiryIndexValue(existing, key);
  if (
    parsed === null
    || parsed.sessionId !== value.sessionId
    || parsed.expiresAt !== value.expiresAt
  ) {
    throw new Error('Photo transfer expiry index conflict.');
  }
}

function manifestWriteResult(result: { modified: boolean; etag?: string }) {
  if (!result.modified) {
    throw new Error('Photo transfer manifest write conflict.');
  }
  if (!validEtag(result.etag)) {
    throw new Error('Photo transfer manifest write is missing an ETag.');
  }
  return { etag: result.etag };
}

export function createPhotoTransferStoreAdapter(blobStore: BlobStore): PhotoTransferStore {
  return {
    getManifest(sessionId) {
      return readManifest(blobStore, sessionId);
    },

    async setManifest(sessionId, manifest, condition) {
      const validated = parsePhotoTransferManifest(manifest);
      ensureManifestMatchesSession(validated, sessionId);
      const parsedCondition = parseWriteCondition(condition);

      if ('onlyIfNew' in parsedCondition) {
        await ensureExpiryIndex(blobStore, validated);
      }

      const result = await blobStore.setJSON(
        derivePhotoTransferManifestKey(sessionId),
        validated,
        parsedCondition,
      );
      return manifestWriteResult(result);
    },

    async putCiphertext(sessionId, index, ciphertext) {
      const result = await blobStore.set(
        derivePhotoTransferFileKey(sessionId, index),
        ciphertext,
        { onlyIfNew: true },
      );
      if (!result.modified) throw new Error('Photo transfer ciphertext already exists.');
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
      const stored = await readManifest(blobStore, sessionId);
      for (let index = 0; index < MAX_PHOTO_TRANSFER_IMAGES; index += 1) {
        await blobStore.delete(derivePhotoTransferFileKey(sessionId, index));
      }
      await blobStore.delete(derivePhotoTransferManifestKey(sessionId));
      if (stored !== null) {
        await blobStore.delete(derivePhotoTransferExpiryIndexKey(
          sessionId,
          stored.manifest.expiresAt,
        ));
      }
    },

    async listExpiredSessionCandidates(now, limit = 100) {
      if (!Number.isSafeInteger(now) || now <= 0) {
        throw new Error('A valid current time is required.');
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('Invalid photo transfer candidate limit.');
      }

      const pages = blobStore.list({
        prefix: EXPIRY_INDEX_PREFIX,
        paginate: true,
      });
      const firstPage = await pages[Symbol.asyncIterator]().next();
      if (firstPage.done) return [];

      const maxInspections = Math.min(
        limit * EXPIRY_SCAN_MULTIPLIER,
        MAX_EXPIRY_SCAN_ENTRIES,
      );
      const expired: StoredPhotoTransferManifest[] = [];
      let inspected = 0;

      for (const blob of firstPage.value.blobs) {
        if (inspected >= maxInspections || expired.length >= limit) break;
        inspected += 1;
        const indexedExpiry = expiryTimestampFromKey(blob.key);
        if (indexedExpiry === null) continue;
        if (indexedExpiry > now) break;

        const indexStored = await blobStore.get(blob.key, { type: 'json' });
        const indexValue = parseExpiryIndexValue(indexStored, blob.key);
        if (indexValue === null) continue;

        let stored: StoredPhotoTransferManifest | null;
        try {
          stored = await readManifest(blobStore, indexValue.sessionId);
        } catch {
          continue;
        }
        if (stored === null) {
          await blobStore.delete(blob.key);
          continue;
        }
        if (stored.manifest.expiresAt !== indexValue.expiresAt) {
          continue;
        }
        if (stored.manifest.expiresAt <= now) expired.push(stored);
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
