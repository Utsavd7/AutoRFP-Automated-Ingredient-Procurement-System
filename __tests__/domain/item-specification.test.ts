import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  ItemSpecificationValidationError,
  validateItemSpecification,
} from '@/lib/domain/item-specification';
import { PROCUREMENT_CATEGORIES } from '@/lib/domain/procurement-categories';

const expectedCategories = {
  VEGETABLES: 'Vegetables',
  FRUITS: 'Fruits',
  DAIRY: 'Dairy',
  GRAINS_PULSES: 'Grains & Pulses',
  FLOUR_BAKERY: 'Flour & Bakery',
  OILS_FATS: 'Oils & Fats',
  SPICES_SEASONINGS: 'Spices & Seasonings',
  DRY_GOODS: 'Dry Goods',
  BEVERAGES: 'Beverages',
  COFFEE_TEA: 'Coffee & Tea',
  MEAT_POULTRY: 'Meat & Poultry',
  SEAFOOD: 'Seafood',
  EGGS: 'Eggs',
  FROZEN_FOODS: 'Frozen Foods',
  READY_MADE_OUTSOURCED: 'Ready-made & Outsourced',
  SWEETS_DESSERTS: 'Sweets & Desserts',
  SAUCES_CONDIMENTS: 'Sauces & Condiments',
  PACKAGING_DISPOSABLES: 'Packaging & Disposables',
  CLEANING_HYGIENE: 'Cleaning & Hygiene',
  GAS_FUEL: 'Gas & Fuel',
  KITCHEN_SUPPLIES: 'Kitchen Supplies',
  OTHER: 'Other',
} as const;

function webpBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(Math.max(0, size - 8), 4);
  bytes.write('WEBP', 8, 'ascii');
  return bytes;
}

describe('procurement categories', () => {
  test('publishes exactly the 22 stable category keys and plain-English labels', () => {
    expect(PROCUREMENT_CATEGORIES).toEqual(expectedCategories);
    expect(Object.keys(PROCUREMENT_CATEGORIES)).toHaveLength(22);
  });

  test.each(Object.keys(expectedCategories))('accepts category %s', (category) => {
    expect(validateItemSpecification({ v: 1, category })).toEqual({ v: 1, category });
  });

  test('rejects an unknown category', () => {
    expect(() => validateItemSpecification({ v: 1, category: 'UNKNOWN' })).toThrow(
      ItemSpecificationValidationError,
    );
  });
});

describe('item specification v1', () => {
  test('accepts canonical nullable text fields and a canonical HTTPS reference URL', () => {
    const specification = {
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

    expect(validateItemSpecification(specification)).toEqual(specification);
  });

  test('rejects every unknown specification key', () => {
    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', arbitrary: true }),
    ).toThrow(/unknown.*arbitrary/i);
  });

  test.each([
    null,
    [],
    new Date(),
    new Map(),
    Object.create({ v: 1, category: 'OTHER' }),
    (() => {
      const cyclic: Record<string, unknown> = { v: 1, category: 'OTHER' };
      cyclic.self = cyclic;
      return cyclic;
    })(),
  ])('rejects a non-plain or otherwise invalid specification object %#', (input) => {
    expect(() => validateItemSpecification(input)).toThrow(
      ItemSpecificationValidationError,
    );
  });

  test.each([undefined, null, 0, 2, '1', BigInt(1)])(
    'requires the literal version 1 instead of %p',
    (v) => {
      expect(() => validateItemSpecification({ v, category: 'OTHER' })).toThrow(/version/i);
    },
  );

  test.each([
    ['description', ' Fresh'],
    ['preferredBrand', 'Fresh '],
    ['packSize', ''],
    ['qualityGrade', '   '],
    ['notes', 'Line one\r\nLine two'],
    ['description', 'before\u0000after'],
    ['notes', '\ud800'],
  ])('rejects ambiguous non-canonical text in %s', (field, value) => {
    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', [field]: value }),
    ).toThrow(new RegExp(field, 'i'));
  });

  test.each([
    ['description', 'd'.repeat(501)],
    ['preferredBrand', 'b'.repeat(121)],
    ['packSize', 'p'.repeat(121)],
    ['qualityGrade', 'q'.repeat(121)],
    ['notes', 'n'.repeat(1001)],
  ])('enforces the conservative maximum length for %s', (field, value) => {
    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', [field]: value }),
    ).toThrow(new RegExp(field, 'i'));
  });

  test.each([
    ['description', undefined],
    ['description', 1],
    ['preferredBrand', () => 'brand'],
    ['packSize', Symbol('pack')],
    ['qualityGrade', BigInt(1)],
    ['notes', new String('notes')],
    ['referenceUrl', new URL('https://example.com/')],
    ['thumbnailWebpBase64', new Uint8Array()],
  ])('rejects a present non-string/non-null %s value', (field, value) => {
    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', [field]: value }),
    ).toThrow(ItemSpecificationValidationError);
  });

  test('accepts a decoded WebP thumbnail at exactly 48 KiB', () => {
    const thumbnailWebpBase64 = webpBytes(
      DOCUMENT_LIMITS.itemSpecification.thumbnailDecodedBytes,
    ).toString('base64');

    expect(
      validateItemSpecification({ v: 1, category: 'OTHER', thumbnailWebpBase64 }),
    ).toEqual({ v: 1, category: 'OTHER', thumbnailWebpBase64 });
  });

  test('rejects a decoded WebP thumbnail at 48 KiB plus one byte', () => {
    const thumbnailWebpBase64 = webpBytes(
      DOCUMENT_LIMITS.itemSpecification.thumbnailDecodedBytes + 1,
    ).toString('base64');

    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', thumbnailWebpBase64 }),
    ).toThrow(/48 KiB/i);
  });

  test('rejects base64 whose decoded bytes lack the RIFF....WEBP signature', () => {
    const thumbnailWebpBase64 = Buffer.alloc(12).toString('base64');

    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', thumbnailWebpBase64 }),
    ).toThrow(/WebP/i);
  });

  test.each(['not-base64!', 'UklGRg==\n', 'UklGRg', 'UklGRg===']) (
    'rejects malformed or noncanonical base64 %p',
    (thumbnailWebpBase64) => {
      expect(() =>
        validateItemSpecification({ v: 1, category: 'OTHER', thumbnailWebpBase64 }),
      ).toThrow(/base64/i);
    },
  );

  test.each([
    'http://example.com/reference',
    'https://user:secret@example.com/reference',
    'https://example.com/reference#details',
    'https://example.com',
    'HTTPS://EXAMPLE.COM/reference',
    ' https://example.com/reference',
  ])('rejects unsafe or noncanonical reference URL %p', (referenceUrl) => {
    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', referenceUrl }),
    ).toThrow(/referenceUrl/i);
  });

  test('rejects a canonical reference URL over 2048 characters', () => {
    const prefix = 'https://example.com/';
    const referenceUrl = `${prefix}${'a'.repeat(
      DOCUMENT_LIMITS.itemSpecification.referenceUrlCharacters + 1 - prefix.length,
    )}`;
    expect(referenceUrl).toHaveLength(2049);

    expect(() =>
      validateItemSpecification({ v: 1, category: 'OTHER', referenceUrl }),
    ).toThrow(/2048/i);
  });
});
