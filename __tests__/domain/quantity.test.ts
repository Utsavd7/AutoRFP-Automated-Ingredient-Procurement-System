import {
  convertQuantity,
  formatQuantity,
  normalizeUnit,
  parseQuantityToMilli,
} from '@/lib/domain/quantity';

describe('procurement quantity primitives', () => {
  test.each([
    ['kg', 'KILOGRAM'],
    ['Kilograms', 'KILOGRAM'],
    ['g', 'GRAM'],
    ['L', 'LITRE'],
    ['liters', 'LITRE'],
    ['ml', 'MILLILITRE'],
    ['pcs', 'PIECE'],
    ['pack', 'PACK'],
    ['cases', 'CASE'],
    ['CRATE', 'CRATE'],
  ])('normalizes user unit %s to %s', (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected);
  });

  test.each(['', 'dozen', 'metre', 'kg/l'])('rejects unsupported unit %p', (input) => {
    expect(() => normalizeUnit(input)).toThrow();
  });

  test.each([
    ['1', '1000', '1'],
    ['1.2', '1200', '1.2'],
    ['0.001', '1', '0.001'],
    [{ toString: () => '125.500' }, '125500', '125.5'],
    [2, '2000', '2'],
    ['999999999999999.999', '999999999999999999', '999999999999999.999'],
  ])('parses exact Decimal(18,3)-compatible quantity %p', (input, scaled, canonical) => {
    const quantity = parseQuantityToMilli(input);

    expect(quantity).toBe(BigInt(scaled));
    expect(formatQuantity(quantity)).toBe(canonical);
  });

  test.each([
    '0',
    '-1',
    '01',
    '.5',
    '1.',
    '1.0001',
    '1e3',
    ' 1',
    0.5,
    Number.POSITIVE_INFINITY,
    '1000000000000000',
  ])('rejects zero, unsafe, malformed, or overflowing quantity %p', (input) => {
    expect(() => parseQuantityToMilli(input)).toThrow();
  });

  test.each([
    ['1.25', 'KILOGRAM', 'GRAM', '1250'],
    ['750', 'GRAM', 'KILOGRAM', '0.75'],
    ['1.5', 'LITRE', 'MILLILITRE', '1500'],
    ['250', 'MILLILITRE', 'LITRE', '0.25'],
    ['3', 'PIECE', 'PIECE', '3'],
  ] as const)(
    'converts %s %s to compatible %s exactly',
    (quantity, fromUnit, toUnit, expected) => {
      expect(convertQuantity(quantity, fromUnit, toUnit)).toBe(expected);
    },
  );

  test.each([
    ['1', 'KILOGRAM', 'LITRE'],
    ['1', 'GRAM', 'PIECE'],
    ['1', 'MILLILITRE', 'KILOGRAM'],
  ] as const)('rejects cross-dimension conversion from %s %s to %s', (quantity, from, to) => {
    expect(() => convertQuantity(quantity, from, to)).toThrow();
  });

  test('requires an explicit positive pack quantity for container conversion', () => {
    expect(() => convertQuantity('2', 'CASE', 'PIECE')).toThrow();
    expect(() => convertQuantity('2', 'CASE', 'PIECE', '0')).toThrow();
    expect(() => convertQuantity('2', 'CASE', 'PIECE', '-12')).toThrow();
  });

  test('converts containers only when their pack quantity is explicit', () => {
    expect(convertQuantity('2', 'CASE', 'PIECE', '12')).toBe('24');
    expect(convertQuantity('24', 'PIECE', 'CASE', '12')).toBe('2');
    expect(convertQuantity('1.5', 'PACK', 'GRAM', '500')).toBe('750');
    expect(convertQuantity('50', 'KILOGRAM', 'CRATE', '25')).toBe('2');
  });

  test('rejects ambiguous container-to-container and unrepresentable conversions', () => {
    expect(() => convertQuantity('1', 'CASE', 'PACK', '12')).toThrow();
    expect(() => convertQuantity('1', 'PIECE', 'CASE', '3')).toThrow();
    expect(() => convertQuantity('0.001', 'GRAM', 'KILOGRAM')).toThrow();
  });

  test('rejects conversion overflow', () => {
    expect(() =>
      convertQuantity('999999999999999.999', 'KILOGRAM', 'GRAM'),
    ).toThrow();
    expect(() =>
      convertQuantity('999999999999999.999', 'CASE', 'PIECE', '2'),
    ).toThrow();
  });
});
