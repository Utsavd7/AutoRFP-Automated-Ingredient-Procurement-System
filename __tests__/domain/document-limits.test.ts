import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  assertBoundedJson,
  postgresJsonByteLength,
} from '@/lib/domain/postgres-json';

describe('bounded PostgreSQL JSON documents', () => {
  test('exposes the approved centralized document limits', () => {
    expect(DOCUMENT_LIMITS).toEqual({
      itemSpecification: { thumbnailDecodedBytes: 48 * 1024, referenceUrlCharacters: 2048 },
      menu: { jsonBytes: 512 * 1024, dishes: 250, ingredients: 1000 },
      supplierCapabilities: { jsonBytes: 64 * 1024, itemPreferences: 250 },
      requestItems: { jsonBytes: 512 * 1024, items: 250 },
      requestSourcing: { jsonBytes: 64 * 1024 },
      selectedSuppliers: 20,
      quoteRevisions: { jsonBytes: 2 * 1024 * 1024, revisions: 10 },
      awardLines: { jsonBytes: 2 * 1024 * 1024, lines: 2000 },
      awardReceiving: { jsonBytes: 32 * 1024, suppliers: 20 },
      awardSupplierSnapshots: { jsonBytes: 2 * 1024 * 1024, suppliers: 20 },
      awardDeliverySnapshot: { jsonBytes: 16 * 1024 },
      thumbnails: {
        perDocument: 8,
        decodedBytesPerDocument: 256 * 1024,
        decodedBytesPerTenant: 4 * 1024 * 1024,
      },
    });
  });

  test('counts PostgreSQL spacing, UTF-8, and expanded numbers independent of key order', () => {
    const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

    expect(postgresJsonByteLength({ a: [1, 'x'] })).toBe(bytes('{"a": [1, "x"]}'));
    expect(postgresJsonByteLength({ emoji: '🥕' })).toBe(bytes('{"emoji": "🥕"}'));
    expect(postgresJsonByteLength({ a: 1, bb: ['x'] })).toBe(
      bytes('{"a": 1, "bb": ["x"]}'),
    );
    expect(postgresJsonByteLength({ longer: 1e21, b: 2 })).toBe(
      postgresJsonByteLength({ b: 2, longer: 1e21 }),
    );
    expect(postgresJsonByteLength({ longer: 1e21 })).toBe(
      bytes('{"longer": 1000000000000000000000}'),
    );
  });

  test('rejects non-JSON values without silently changing them', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 });
    const hidden = Object.defineProperty({}, 'value', { value: 1 });
    const invalidValues = [
      cyclic,
      () => undefined,
      undefined,
      BigInt(1),
      Symbol('value'),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(),
      new Map(),
      new Set(),
      new Uint8Array(),
      new ArrayBuffer(1),
      Array(1),
      new String('value'),
      /value/,
      Object.create({ inherited: true }),
      { value: () => undefined },
      { value: undefined },
      { [Symbol('key')]: true },
      { value: 'before\u0000after' },
      { value: '\ud800' },
      accessor,
      hidden,
    ];

    for (const value of invalidValues) {
      expect(() => postgresJsonByteLength(value)).toThrow(/valid JSON/i);
    }
  });

  test('serializes deeply nested valid JSON without using the JavaScript call stack', () => {
    let value: unknown = null;
    for (let depth = 0; depth < 10_000; depth += 1) value = [value];

    expect(postgresJsonByteLength(value)).toBe(20_004);
  });

  test('allows an exact byte limit and rejects over-limit documents or invalid caps', () => {
    const value = { label: 'सब्ज़ी' };
    const bytes = postgresJsonByteLength(value);

    expect(() => assertBoundedJson(value, bytes, 'Item specification')).not.toThrow();
    expect(() => assertBoundedJson(value, bytes - 1, 'Item specification')).toThrow(
      `Item specification exceeds its ${bytes - 1}-byte JSON limit`,
    );
    for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => assertBoundedJson({}, limit)).toThrow(/positive integer/i);
    }
  });

  test('stops bounded validation as soon as a large shallow array exceeds its cap', () => {
    const value = Array(100_000).fill(0);
    Object.defineProperty(value, 1, { enumerable: true, get: () => 0 });

    expect(() => assertBoundedJson(value, 1, 'Large array')).toThrow(
      'Large array exceeds its 1-byte JSON limit',
    );
  });
});
