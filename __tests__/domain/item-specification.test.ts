import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  ItemSpecificationValidationError,
  validateItemSpecification,
} from '@/lib/domain/item-specification';
import { PROCUREMENT_CATEGORIES } from '@/lib/domain/procurement-categories';

const expectedCategories = {
  VEGETABLES: 'Vegetables', FRUITS: 'Fruits', DAIRY: 'Dairy',
  GRAINS_PULSES: 'Grains & Pulses', FLOUR_BAKERY: 'Flour & Bakery',
  OILS_FATS: 'Oils & Fats', SPICES_SEASONINGS: 'Spices & Seasonings',
  DRY_GOODS: 'Dry Goods', BEVERAGES: 'Beverages', COFFEE_TEA: 'Coffee & Tea',
  MEAT_POULTRY: 'Meat & Poultry', SEAFOOD: 'Seafood', EGGS: 'Eggs',
  FROZEN_FOODS: 'Frozen Foods', READY_MADE_OUTSOURCED: 'Ready-made & Outsourced',
  SWEETS_DESSERTS: 'Sweets & Desserts', SAUCES_CONDIMENTS: 'Sauces & Condiments',
  PACKAGING_DISPOSABLES: 'Packaging & Disposables',
  CLEANING_HYGIENE: 'Cleaning & Hygiene', GAS_FUEL: 'Gas & Fuel',
  KITCHEN_SUPPLIES: 'Kitchen Supplies', OTHER: 'Other',
} as const;

const TINY_WEBP_BASE64 =
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

function webpBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  Buffer.from(TINY_WEBP_BASE64, 'base64').copy(bytes);
  bytes.writeUInt32LE(size - 8, 4);
  bytes.writeUInt32LE(size - 20, 16);
  return bytes;
}

function riffChunk(tag: string, data: Buffer, includePadding = true): Buffer {
  const padding = includePadding && data.length % 2 === 1 ? 1 : 0;
  const bytes = Buffer.alloc(8 + data.length + padding);
  bytes.write(tag, 0, 'ascii');
  bytes.writeUInt32LE(data.length, 4);
  data.copy(bytes, 8);
  return bytes;
}

function webpFile(...chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const bytes = Buffer.alloc(12 + body.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  body.copy(bytes, 12);
  return bytes;
}

function animationChunks(animationFlag = true) {
  const vp8x = Buffer.alloc(10);
  if (animationFlag) vp8x[0] = 0x02;
  const vp8Chunk = Buffer.from(TINY_WEBP_BASE64, 'base64').subarray(12);
  const frame = Buffer.concat([Buffer.alloc(16), vp8Chunk]);
  return {
    vp8x: riffChunk('VP8X', vp8x),
    anim: riffChunk('ANIM', Buffer.alloc(6)),
    anmf: riffChunk('ANMF', frame),
  };
}

function animatedWebp(): Buffer {
  const { vp8x, anim, anmf } = animationChunks();
  return webpFile(vp8x, anim, anmf);
}

function webpChunk(tag: string, data: Buffer, includePadding = true): Buffer {
  return webpFile(riffChunk(tag, data, includePadding));
}

function validateThumbnail(thumbnailWebpBase64: string) {
  return validateItemSpecification({ v: 1, category: 'OTHER', thumbnailWebpBase64 });
}

describe('procurement categories and item specification v1', () => {
  test('publishes and accepts exactly the 22 stable categories', () => {
    expect(PROCUREMENT_CATEGORIES).toEqual(expectedCategories);
    expect(Object.keys(PROCUREMENT_CATEGORIES)).toHaveLength(22);
    for (const category of Object.keys(expectedCategories)) {
      expect(validateItemSpecification({ v: 1, category })).toEqual({ v: 1, category });
    }
    expect(() => validateItemSpecification({ v: 1, category: 'UNKNOWN' })).toThrow(
      ItemSpecificationValidationError,
    );
  });

  test('accepts only the exact versioned shape with canonical nullable text', () => {
    const valid = {
      v: 1,
      category: 'VEGETABLES',
      description: 'Fresh red tomatoes',
      preferredBrand: null,
      packSize: '5 kg crate',
      qualityGrade: 'Grade A',
      notes: null,
      referenceUrl: 'https://example.com/reference?item=tomato',
      thumbnailWebpBase64: null,
    };
    expect(validateItemSpecification(valid)).toEqual(valid);

    const invalidInputs = [
      { v: 1, category: 'OTHER', arbitrary: true },
      { v: 2, category: 'OTHER' },
      { v: 1, category: 'OTHER', description: ' leading' },
      { v: 1, category: 'OTHER', description: 'd'.repeat(501) },
      { v: 1, category: 'OTHER', notes: 'line one\r\nline two' },
      { v: 1, category: 'OTHER', preferredBrand: undefined },
      Object.create({ v: 1, category: 'OTHER' }),
      null,
      [],
    ];
    for (const input of invalidInputs) {
      expect(() => validateItemSpecification(input)).toThrow(
        ItemSpecificationValidationError,
      );
    }
    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', arbitrary: true }),
    ).toThrow(/unknown.*arbitrary/i);
  });

  test('enforces every nullable text field boundary and canonical form', () => {
    const limits = {
      description: 500,
      preferredBrand: 120,
      packSize: 120,
      qualityGrade: 120,
      notes: 1000,
    } as const;
    const ambiguous = ['', ' leading', 'trailing ', 'before\rafter', 'before\u0000after', '\ud800'];

    for (const [field, limit] of Object.entries(limits)) {
      expect(
        validateItemSpecification({ v: 1, category: 'OTHER', [field]: 'x'.repeat(limit) }),
      ).toBeDefined();
      expect(validateItemSpecification({ v: 1, category: 'OTHER', [field]: null })).toBeDefined();
      expect(() =>
        validateItemSpecification({ v: 1, category: 'OTHER', [field]: 'x'.repeat(limit + 1) }),
      ).toThrow(ItemSpecificationValidationError);
      for (const value of ambiguous) {
        expect(() =>
          validateItemSpecification({ v: 1, category: 'OTHER', [field]: value }),
        ).toThrow(ItemSpecificationValidationError);
      }
    }
  });

  test('accepts canonical HTTPS URLs and rejects unsafe or ambiguous forms', () => {
    for (const referenceUrl of [
      'https://example.com/reference?item=tomato',
      'https://example.com/reference?q=a%20b',
    ]) {
      expect(validateItemSpecification({ v: 1, category: 'OTHER', referenceUrl })).toEqual({
        v: 1, category: 'OTHER', referenceUrl,
      });
    }

    const prefix = 'https://example.com/';
    const tooLong = `${prefix}${'a'.repeat(2049 - prefix.length)}`;
    for (const referenceUrl of [
      'http://example.com/reference',
      'https://user:secret@example.com/reference',
      'https://example.com/reference#details',
      'https://example.com/reference#',
      'https://example.com/%41',
      'https://example.com/%7e',
      'https://example.com/reference?',
      'https://example.com',
      'HTTPS://EXAMPLE.COM/reference',
      tooLong,
    ]) {
      expect(() =>
        validateItemSpecification({ v: 1, category: 'OTHER', referenceUrl }),
      ).toThrow(ItemSpecificationValidationError);
    }
  });

  test('accepts a genuine WebP through exactly 48 KiB and rejects 48 KiB plus one', () => {
    expect(validateThumbnail(TINY_WEBP_BASE64)).toBeDefined();
    const exact = webpBytes(DOCUMENT_LIMITS.itemSpecification.thumbnailDecodedBytes);
    expect(validateThumbnail(exact.toString('base64'))).toBeDefined();
    const oversized = webpBytes(
      DOCUMENT_LIMITS.itemSpecification.thumbnailDecodedBytes + 1,
    );
    expect(() => validateThumbnail(oversized.toString('base64'))).toThrow(/48 KiB/i);
  });

  test('accepts a valid animated WebP with image data inside an ANMF frame', () => {
    expect(validateThumbnail(animatedWebp().toString('base64'))).toBeDefined();
  });

  test('rejects incomplete or unflagged animated WebP containers', () => {
    const animated = animationChunks();
    const unflagged = animationChunks(false);
    const malformed = [
      webpFile(animated.anmf),
      webpFile(animated.vp8x, animated.anmf),
      webpFile(unflagged.vp8x, unflagged.anim, unflagged.anmf),
    ];

    for (const bytes of malformed) {
      expect(() => validateThumbnail(bytes.toString('base64'))).toThrow(/WebP/i);
    }
  });

  test('rejects huge encoded thumbnails before decoding', () => {
    const atobSpy = jest.spyOn(globalThis, 'atob');
    try {
      expect(() => validateThumbnail('A'.repeat(8 * 1024 * 1024))).toThrow(
        ItemSpecificationValidationError,
      );
      expect(atobSpy).not.toHaveBeenCalled();
    } finally {
      atobSpy.mockRestore();
    }
  });

  test('checks decoded size before canonical re-encoding', () => {
    const atobSpy = jest.spyOn(globalThis, 'atob').mockReturnValue(
      'A'.repeat(DOCUMENT_LIMITS.itemSpecification.thumbnailDecodedBytes + 1),
    );
    const btoaSpy = jest.spyOn(globalThis, 'btoa');
    try {
      expect(() => validateThumbnail('AAAA')).toThrow(ItemSpecificationValidationError);
      expect(atobSpy).toHaveBeenCalledTimes(1);
      expect(btoaSpy).not.toHaveBeenCalled();
    } finally {
      atobSpy.mockRestore();
      btoaSpy.mockRestore();
    }
  });

  test('rejects fake, malformed, or structurally invalid WebP payloads', () => {
    const headerOnly = Buffer.alloc(12);
    headerOnly.write('RIFF', 0, 'ascii');
    headerOnly.writeUInt32LE(4, 4);
    headerOnly.write('WEBP', 8, 'ascii');
    const malformedWebps = [
      headerOnly,
      Buffer.alloc(12),
      webpBytes(42),
      webpBytes(42),
      webpBytes(42),
      webpChunk('VP8X', Buffer.alloc(10)),
      webpChunk('VP8X', Buffer.alloc(9)),
      webpChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0]), false),
    ];
    malformedWebps[2].writeUInt32LE(1, 4);
    malformedWebps[3].write('JUNK', 12, 'ascii');
    malformedWebps[4].writeUInt32LE(1000, 16);

    for (const bytes of malformedWebps) {
      expect(() => validateThumbnail(bytes.toString('base64'))).toThrow(/WebP/i);
    }
    for (const base64 of ['not-base64!', 'UklGRg==\n', 'UklGRg', 'UklGRg===']) {
      expect(() => validateThumbnail(base64)).toThrow(/base64/i);
    }
  });
});
