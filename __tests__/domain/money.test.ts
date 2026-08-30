import {
  calculateGst,
  formatInr,
  multiplyPaise,
  parseInrToPaise,
} from '@/lib/domain/money';

describe('India money primitives', () => {
  test.each([
    ['0', '0'],
    ['1', '100'],
    ['1.2', '120'],
    ['1.23', '123'],
    [{ toString: () => '123.45' }, '12345'],
    [7, '700'],
  ])('parses exact INR input %p into paise', (input, expected) => {
    expect(parseInrToPaise(input)).toBe(BigInt(expected));
  });

  test.each([
    '-1',
    '01.00',
    '1.',
    '.50',
    '1.234',
    '1,000.00',
    '₹1.00',
    ' 1.00',
    '1e2',
    0.1,
    Number.NaN,
    '92233720368547758.08',
  ])('rejects unsafe, negative, malformed, or overflowing INR input %p', (input) => {
    expect(() => parseInrToPaise(input)).toThrow();
  });

  test.each([
    ['0', '₹0.00'],
    ['5', '₹0.05'],
    ['123456789', '₹12,34,567.89'],
    ['9223372036854775807', '₹92,23,37,20,36,85,47,758.07'],
  ])('formats paise %s using stable Indian grouping', (paise, expected) => {
    expect(formatInr(BigInt(paise))).toBe(expected);
  });

  test('rejects negative and overflowing paise before display', () => {
    expect(() => formatInr(BigInt('-1'))).toThrow();
    expect(() => formatInr(BigInt('9223372036854775808'))).toThrow();
  });

  test('rounds fractional paise half up when multiplying by a decimal quantity', () => {
    expect(multiplyPaise(BigInt('101'), '0.500')).toBe(BigInt('51'));
    expect(multiplyPaise(BigInt('199'), '2.505')).toBe(BigInt('498'));
  });

  test('calculates GST from a tax-exclusive amount in basis points', () => {
    expect(
      calculateGst({
        amountPaise: BigInt('10010'),
        gstBasisPoints: 500,
        inclusive: false,
      }),
    ).toEqual({
      netPaise: BigInt('10010'),
      gstPaise: BigInt('501'),
      grossPaise: BigInt('10511'),
    });
  });

  test('extracts GST from a tax-inclusive amount without changing the gross amount', () => {
    expect(
      calculateGst({
        amountPaise: BigInt('11800'),
        gstBasisPoints: 1800,
        inclusive: true,
      }),
    ).toEqual({
      netPaise: BigInt('10000'),
      gstPaise: BigInt('1800'),
      grossPaise: BigInt('11800'),
    });
  });

  test.each([
    { amountPaise: BigInt('-1'), gstBasisPoints: 500, inclusive: false },
    { amountPaise: BigInt('1'), gstBasisPoints: -1, inclusive: false },
    { amountPaise: BigInt('1'), gstBasisPoints: 10001, inclusive: false },
    { amountPaise: BigInt('9223372036854775807'), gstBasisPoints: 1, inclusive: false },
  ])('rejects invalid or overflowing GST calculations', (input) => {
    expect(() => calculateGst(input)).toThrow();
  });

});
