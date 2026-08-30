import {
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

});
