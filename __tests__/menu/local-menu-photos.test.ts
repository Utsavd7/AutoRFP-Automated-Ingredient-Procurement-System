import {
  groupLocalMenuPhotoRecords,
  parseLocalMenuPhotoRecord,
} from '@/lib/menu/local-menu-photos';

function record(overrides: Record<string, unknown> = {}) {
  const blob = new Blob(['photo'], { type: 'image/jpeg' });
  return {
    id: 'photo-a',
    workspaceId: 'workspace-a',
    batchId: 'batch-a',
    createdAt: 1_800_000_000_000,
    name: 'menu.jpg',
    type: 'image/jpeg',
    size: blob.size,
    blob,
    ...overrides,
  };
}

describe('local menu photo records', () => {
  it('accepts exact bounded records and rejects extra, malformed, or mismatched fields', () => {
    expect(parseLocalMenuPhotoRecord(record())).toEqual(record());

    for (const value of [
      record({ token: 'must-never-be-stored' }),
      record({ workspaceId: '' }),
      record({ menuId: '' }),
      record({ type: 'image/gif' }),
      record({ size: 999 }),
      record({ blob: 'not-a-blob' }),
    ]) {
      expect(() => parseLocalMenuPhotoRecord(value)).toThrow('Invalid local menu photo record.');
    }
  });

  it('never returns another workspace and bounds newest batches and photos', () => {
    const records = [
      record({ id: 'other', workspaceId: 'workspace-b', batchId: 'other', createdAt: 9_999 }),
      ...Array.from({ length: 14 }, (_, index) => record({
        id: `photo-${index}`,
        batchId: `batch-${index}`,
        createdAt: 1_000 + index,
      })),
    ];

    const batches = groupLocalMenuPhotoRecords(records, 'workspace-a', {
      maxBatches: 12,
      maxPhotos: 120,
    });

    expect(batches).toHaveLength(12);
    expect(batches[0]).toMatchObject({ batchId: 'batch-13', workspaceId: 'workspace-a' });
    expect(batches.every((batch) => batch.workspaceId === 'workspace-a')).toBe(true);
    expect(batches.flatMap((batch) => batch.photos)).toHaveLength(12);
  });

  it('keeps a whole newest batch rather than partially returning it at the photo bound', () => {
    const records = [
      ...Array.from({ length: 3 }, (_, index) => record({
        id: `new-${index}`,
        batchId: 'new',
        createdAt: 2_000,
      })),
      ...Array.from({ length: 3 }, (_, index) => record({
        id: `old-${index}`,
        batchId: 'old',
        createdAt: 1_000,
      })),
    ];

    const batches = groupLocalMenuPhotoRecords(records, 'workspace-a', {
      maxBatches: 12,
      maxPhotos: 4,
    });

    expect(batches.map(({ batchId }) => batchId)).toEqual(['new']);
    expect(batches[0].photos).toHaveLength(3);
  });
});
