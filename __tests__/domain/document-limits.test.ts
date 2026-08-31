import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  assertBoundedJson,
  postgresJsonByteLength,
} from '@/lib/domain/postgres-json';

describe('bounded PostgreSQL JSON documents', () => {
  test('exposes the approved centralized document limits', () => {
    expect(DOCUMENT_LIMITS).toEqual({
      itemSpecification: {
        thumbnailDecodedBytes: 48 * 1024,
        referenceUrlCharacters: 2048,
      },
      menu: { jsonBytes: 512 * 1024, dishes: 250, ingredients: 1000 },
      supplierCapabilities: { jsonBytes: 64 * 1024, itemPreferences: 250 },
      requestItems: { jsonBytes: 512 * 1024, items: 250 },
      selectedSuppliers: 20,
      quoteRevisions: { jsonBytes: 2 * 1024 * 1024, revisions: 10 },
      awardLines: { jsonBytes: 2 * 1024 * 1024, lines: 2000 },
      thumbnails: {
        perDocument: 8,
        decodedBytesPerDocument: 256 * 1024,
        decodedBytesPerTenant: 4 * 1024 * 1024,
      },
    });
  });

  test('counts PostgreSQL jsonb text spaces and UTF-8 bytes', () => {
    const postgresText = '{"a": [1, "x"]}';

    expect(postgresJsonByteLength({ a: [1, 'x'] })).toBe(
      new TextEncoder().encode(postgresText).byteLength,
    );
    expect(postgresJsonByteLength({ emoji: '🥕' })).toBe(
      new TextEncoder().encode('{"emoji": "🥕"}').byteLength,
    );
  });

  test('uses PostgreSQL jsonb key order and expanded numeric notation', () => {
    expect(postgresJsonByteLength({ longer: 1e21, b: 2 })).toBe(
      new TextEncoder().encode('{"b": 2, "longer": 1000000000000000000000}').byteLength,
    );
  });

  test.each([
    ['cyclic objects', (() => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    })()],
    ['functions', { value: () => undefined }],
    ['undefined', { value: undefined }],
    ['bigints', { value: BigInt(1) }],
    ['symbols', { value: Symbol('value') }],
    ['symbol keys', { [Symbol('key')]: 'value' }],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['dates', new Date('2026-01-01T00:00:00.000Z')],
    ['maps', new Map([['a', 1]])],
    ['sets', new Set([1])],
    ['typed arrays', new Uint8Array([1, 2])],
    ['array buffers', new ArrayBuffer(2)],
    ['sparse arrays', Array(1)],
    ['boxed primitives', new String('value')],
    ['regular expressions', /value/],
    ['non-plain prototype objects', Object.create({ inherited: true })],
    ['PostgreSQL-incompatible null characters', { value: 'before\u0000after' }],
    ['unpaired Unicode surrogates', { value: '\ud800' }],
  ])('rejects %s rather than silently changing the document', (_label, value) => {
    expect(() => postgresJsonByteLength(value)).toThrow(/valid JSON/i);
  });

  test('rejects accessor and non-enumerable properties', () => {
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'hidden work',
    });
    const nonEnumerable = Object.defineProperty({}, 'value', {
      enumerable: false,
      value: 'hidden',
    });

    expect(() => postgresJsonByteLength(accessor)).toThrow(/valid JSON/i);
    expect(() => postgresJsonByteLength(nonEnumerable)).toThrow(/valid JSON/i);
  });

  test('allows an exact byte limit and clearly rejects one byte over it', () => {
    const value = { label: 'सब्ज़ी' };
    const bytes = postgresJsonByteLength(value);

    expect(() => assertBoundedJson(value, bytes, 'Item specification')).not.toThrow();
    expect(() => assertBoundedJson(value, bytes - 1, 'Item specification')).toThrow(
      `Item specification exceeds its ${bytes - 1}-byte JSON limit`,
    );
  });

  test.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects an invalid JSON byte limit %p',
    (maximumBytes) => {
      expect(() => assertBoundedJson({}, maximumBytes)).toThrow(/positive integer/i);
    },
  );
});
