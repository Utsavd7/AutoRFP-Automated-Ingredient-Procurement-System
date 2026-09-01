import {
  MAX_PHOTO_TRANSFER_IMAGE_BYTES,
  PHOTO_TRANSFER_MIME_TYPES,
  isPhotoTransferWorkspaceId,
  sanitizePhotoTransferFilename,
} from '@/lib/menu/photo-transfer-contract';
import type { LocalPhotoBatchInput } from '@/lib/menu/photo-transfer-client';

const DB_NAME = 'QuotePlateMenuPhotos';
const DB_VERSION = 1;
const STORE_NAME = 'quoteplate-local-menu-photos';
const WORKSPACE_BATCH_INDEX = 'workspaceBatch';
const MAX_LOCAL_BATCHES = 12;
const MAX_LOCAL_PHOTOS = 120;

const MIME_TYPES = new Set<string>(PHOTO_TRANSFER_MIME_TYPES);
const LOCAL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,180}$/;

export type LocalMenuPhotoRecord = {
  id: string;
  workspaceId: string;
  batchId: string;
  menuId?: string;
  createdAt: number;
  name: string;
  type: string;
  size: number;
  blob: Blob;
};

export type LocalMenuPhotoBatch = {
  batchId: string;
  workspaceId: string;
  menuId?: string;
  createdAt: number;
  photos: LocalMenuPhotoRecord[];
};

function invalidRecord(): never {
  throw new Error('Invalid local menu photo record.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validLocalId(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_ID_PATTERN.test(value);
}

export function parseLocalMenuPhotoRecord(value: unknown): LocalMenuPhotoRecord {
  if (!isRecord(value)) return invalidRecord();
  const required = [
    'id',
    'workspaceId',
    'batchId',
    'createdAt',
    'name',
    'type',
    'size',
    'blob',
  ];
  const optional = ['menuId'];
  const keys = Object.keys(value);
  if (
    !required.every((key) => key in value)
    || !keys.every((key) => required.includes(key) || optional.includes(key))
    || !validLocalId(value.id)
    || !isPhotoTransferWorkspaceId(value.workspaceId)
    || !validLocalId(value.batchId)
    || (value.menuId !== undefined && !validLocalId(value.menuId))
    || !Number.isSafeInteger(value.createdAt)
    || Number(value.createdAt) <= 0
    || typeof value.name !== 'string'
    || value.name !== sanitizePhotoTransferFilename(value.name)
    || !MIME_TYPES.has(String(value.type))
    || !Number.isSafeInteger(value.size)
    || Number(value.size) <= 0
    || Number(value.size) > MAX_PHOTO_TRANSFER_IMAGE_BYTES
    || !(value.blob instanceof Blob)
    || value.blob.size !== value.size
    || value.blob.type !== value.type
  ) {
    return invalidRecord();
  }
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    batchId: value.batchId,
    ...(value.menuId === undefined ? {} : { menuId: value.menuId as string }),
    createdAt: Number(value.createdAt),
    name: value.name,
    type: value.type as string,
    size: Number(value.size),
    blob: value.blob,
  };
}

export function groupLocalMenuPhotoRecords(
  values: readonly unknown[],
  workspaceId: string,
  limits: { maxBatches: number; maxPhotos: number } = {
    maxBatches: MAX_LOCAL_BATCHES,
    maxPhotos: MAX_LOCAL_PHOTOS,
  },
) {
  if (!isPhotoTransferWorkspaceId(workspaceId)) return [];
  const grouped = new Map<string, LocalMenuPhotoBatch>();
  for (const value of values) {
    let record: LocalMenuPhotoRecord;
    try {
      record = parseLocalMenuPhotoRecord(value);
    } catch {
      continue;
    }
    if (record.workspaceId !== workspaceId) continue;
    const batch = grouped.get(record.batchId) ?? {
      batchId: record.batchId,
      workspaceId,
      ...(record.menuId === undefined ? {} : { menuId: record.menuId }),
      createdAt: record.createdAt,
      photos: [],
    };
    batch.createdAt = Math.max(batch.createdAt, record.createdAt);
    if (record.menuId) batch.menuId = record.menuId;
    batch.photos.push(record);
    grouped.set(record.batchId, batch);
  }

  const newest = [...grouped.values()].sort((left, right) =>
    right.createdAt - left.createdAt || right.batchId.localeCompare(left.batchId));
  const bounded: LocalMenuPhotoBatch[] = [];
  let photoCount = 0;
  for (const batch of newest) {
    if (bounded.length >= limits.maxBatches) break;
    if (photoCount + batch.photos.length > limits.maxPhotos) break;
    batch.photos.sort((left, right) => left.id.localeCompare(right.id));
    bounded.push(batch);
    photoCount += batch.photos.length;
  }
  return bounded;
}

export function localMenuPhotoRecordIdsToEvict(
  values: readonly unknown[],
  workspaceId: string,
  limits: { maxBatches: number; maxPhotos: number } = {
    maxBatches: MAX_LOCAL_BATCHES,
    maxPhotos: MAX_LOCAL_PHOTOS,
  },
) {
  const keptIds = new Set(
    groupLocalMenuPhotoRecords(values, workspaceId, limits)
      .flatMap(({ photos }) => photos.map(({ id }) => id)),
  );
  const evictedIds: string[] = [];
  for (const value of values) {
    let record: LocalMenuPhotoRecord;
    try {
      record = parseLocalMenuPhotoRecord(value);
    } catch {
      continue;
    }
    if (record.workspaceId === workspaceId && !keptIds.has(record.id)) {
      evictedIds.push(record.id);
    }
  }
  return evictedIds;
}

function databaseFactory() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('This browser cannot save menu photos on this laptop.');
  }
  return indexedDB;
}

function requestPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local photo request failed.'));
  });
}

function transactionPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error('Local photo transaction failed.'),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error('Local photo transaction was stopped.'),
    );
  });
}

async function openDatabase() {
  const request = databaseFactory().open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    store.createIndex('workspaceId', 'workspaceId', { unique: false });
    store.createIndex(WORKSPACE_BATCH_INDEX, ['workspaceId', 'batchId'], { unique: false });
  };
  return requestPromise(request);
}

function closeWhenFinished(database: IDBDatabase, done: Promise<void>) {
  return done.finally(() => database.close());
}

export async function saveLocalMenuPhotoBatch(input: LocalPhotoBatchInput) {
  if (
    !isPhotoTransferWorkspaceId(input.workspaceId)
    || !validLocalId(input.batchId)
    || !Number.isSafeInteger(input.createdAt)
    || input.createdAt <= 0
    || input.files.length < 1
    || input.files.length > 10
  ) {
    throw new Error('This photo batch cannot be saved on this laptop.');
  }
  const newRecords = input.files.map((file, index) =>
    parseLocalMenuPhotoRecord({
      id: `${input.batchId}:${String(index).padStart(2, '0')}`,
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      createdAt: input.createdAt,
      name: sanitizePhotoTransferFilename(file.name),
      type: file.type,
      size: file.size,
      blob: file,
    }));
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const existingRequest = store.index('workspaceId').getAll(input.workspaceId);
  existingRequest.onsuccess = () => {
    const replacedIds = new Set(newRecords.map(({ id }) => id));
    const combined = [
      ...existingRequest.result.filter((value) => {
        try {
          return !replacedIds.has(parseLocalMenuPhotoRecord(value).id);
        } catch {
          return true;
        }
      }),
      ...newRecords,
    ];
    newRecords.forEach((record) => store.put(record));
    localMenuPhotoRecordIdsToEvict(combined, input.workspaceId)
      .forEach((recordId) => store.delete(recordId));
  };
  await closeWhenFinished(database, transactionPromise(transaction));
}

export async function associateLocalPhotoBatches(
  workspaceId: string,
  batchIds: readonly string[],
  menuId: string,
) {
  const uniqueBatchIds = [...new Set(batchIds)];
  if (
    !isPhotoTransferWorkspaceId(workspaceId)
    || !validLocalId(menuId)
    || uniqueBatchIds.some((batchId) => !validLocalId(batchId))
  ) {
    throw new Error('These local menu photos could not be linked to the menu.');
  }
  if (uniqueBatchIds.length === 0) return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index(WORKSPACE_BATCH_INDEX);
  for (const batchId of uniqueBatchIds) {
    const request = index.openCursor(IDBKeyRange.only([workspaceId, batchId]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = parseLocalMenuPhotoRecord(cursor.value);
      if (record.workspaceId === workspaceId && record.batchId === batchId) {
        cursor.update({ ...record, menuId });
      }
      cursor.continue();
    };
  }
  await closeWhenFinished(database, transactionPromise(transaction));
}

export async function listLocalMenuPhotoBatches(workspaceId: string) {
  if (!isPhotoTransferWorkspaceId(workspaceId)) return [];
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).index('workspaceId').getAll(workspaceId);
  const values = await requestPromise(request);
  await closeWhenFinished(database, transactionPromise(transaction));
  return groupLocalMenuPhotoRecords(values, workspaceId);
}

export async function deleteLocalMenuPhotoBatch(
  workspaceId: string,
  batchId: string,
) {
  if (!isPhotoTransferWorkspaceId(workspaceId) || !validLocalId(batchId)) return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const request = transaction
    .objectStore(STORE_NAME)
    .index(WORKSPACE_BATCH_INDEX)
    .openKeyCursor(IDBKeyRange.only([workspaceId, batchId]));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
    cursor.continue();
  };
  await closeWhenFinished(database, transactionPromise(transaction));
}
