import {
  compareLatestQuotes,
  type ComparisonQuote,
  type ComparisonRequest,
} from '@/lib/comparison/compare-quotes';

const request: ComparisonRequest = {
  id: 'request-a',
  title: 'Weekly produce',
  deliveryDate: new Date('2027-01-10T00:00:00.000Z'),
  quoteDeadline: new Date('2027-01-09T10:00:00.000Z'),
  commercialTerms: 'Payment in 15 days.',
  items: [
    {
      id: 'tomato',
      name: 'Tomato',
      quantity: '100',
      unit: 'KILOGRAM',
    },
    {
      id: 'coriander',
      name: 'Coriander',
      quantity: '10',
      unit: 'KILOGRAM',
    },
  ],
};

function quote(overrides: Partial<ComparisonQuote> = {}): ComparisonQuote {
  return {
    id: 'quote-a',
    supplierRequestId: 'supplier-request-a',
    supplierId: 'supplier-a',
    supplierName: 'Shakti Foods',
    supplierActive: true,
    revision: 2,
    subtotalPaise: BigInt(79_000_00),
    gstPaise: BigInt(3_950_00),
    freightPaise: BigInt(500_00),
    totalPaise: BigInt(83_450_00),
    deliveryDate: new Date('2027-01-10T00:00:00.000Z'),
    validUntil: new Date('2027-01-11T00:00:00.000Z'),
    commercialTerms: 'Payment in 15 days.',
    notes: null,
    submittedAt: new Date('2027-01-08T09:00:00.000Z'),
    items: [
      {
        id: 'quote-item-tomato',
        requestItemId: 'tomato',
        noQuote: false,
        availableQuantity: '100',
        unit: 'KILOGRAM',
        unitRatePaise: BigInt(700_00),
        gstBasisPoints: 500,
        taxInclusive: false,
        substitution: null,
        subtotalPaise: BigInt(70_000_00),
        gstPaise: BigInt(3_500_00),
        totalPaise: BigInt(73_500_00),
      },
      {
        id: 'quote-item-coriander',
        requestItemId: 'coriander',
        noQuote: false,
        availableQuantity: '10',
        unit: 'KILOGRAM',
        unitRatePaise: BigInt(900_00),
        gstBasisPoints: 500,
        taxInclusive: false,
        substitution: null,
        subtotalPaise: BigInt(9_000_00),
        gstPaise: BigInt(450_00),
        totalPaise: BigInt(9_450_00),
      },
    ],
    ...overrides,
  };
}

describe('deterministic supplier quote comparison', () => {
  it('shows an exact full landed basket without inventing a winner or score', () => {
    const result = compareLatestQuotes(request, [quote()], {
      now: new Date('2027-01-09T00:00:00.000Z'),
    });

    expect(result.request).toMatchObject({
      id: 'request-a',
      itemCount: 2,
      deliveryDate: '2027-01-10',
    });
    expect(result.quotes).toEqual([
      expect.objectContaining({
        quoteId: 'quote-a',
        revision: 2,
        totalPaise: '8345000',
        coveredItemCount: 2,
        fullCoverage: true,
        comparable: true,
        deliveryFit: 'ON_OR_BEFORE',
        expired: false,
        missingTerms: false,
        supplierActive: true,
        awardable: true,
        awardIssues: [],
        missingRequestItemIds: [],
        partialRequestItemIds: [],
        substitutions: [],
      }),
    ]);
    expect(result.quotes[0]).not.toHaveProperty('score');
    expect(result.quotes[0]).not.toHaveProperty('winner');
    expect(result).not.toHaveProperty('recommendation');
  });

  it('normalizes standard units exactly and flags an unrepresentable paise conversion', () => {
    const normalized = quote({
      id: 'quote-grams',
      items: [
        {
          ...quote().items[0]!,
          id: 'quote-item-tomato-grams',
          availableQuantity: '100000',
          unit: 'GRAM',
          unitRatePaise: BigInt(70),
        },
        quote().items[1]!,
      ],
    });
    const gramRequest: ComparisonRequest = {
      ...request,
      items: [
        { ...request.items[0]!, quantity: '100000', unit: 'GRAM' },
        request.items[1]!,
      ],
    };
    const inexact = quote({
      id: 'quote-inexact',
      supplierId: 'supplier-b',
      supplierName: 'GreenLeaf Enterprises',
      items: [
        {
          ...quote().items[0]!,
          id: 'quote-item-tomato-inexact',
          availableQuantity: '100',
          unit: 'KILOGRAM',
          unitRatePaise: BigInt(1),
        },
        quote().items[1]!,
      ],
    });

    const normalizedResult = compareLatestQuotes(request, [normalized], {
      now: new Date('2027-01-09T00:00:00.000Z'),
    });
    const inexactResult = compareLatestQuotes(gramRequest, [inexact], {
      now: new Date('2027-01-09T00:00:00.000Z'),
    });

    expect(normalizedResult.quotes[0]?.items[0])
      .toMatchObject({
        normalizedAvailableQuantity: '100',
        normalizedUnitRatePaise: '70000',
        unitComparable: true,
        coverage: 'FULL',
      });
    expect(inexactResult.quotes[0])
      .toMatchObject({ comparable: false, fullCoverage: false });
    expect(inexactResult.quotes[0]?.items[0])
      .toMatchObject({
        normalizedUnitRatePaise: null,
        unitComparable: false,
        coverage: 'UNIT_MISMATCH',
      });
  });

  it('keeps missing, partial, substitution, delivery, validity, and terms facts visible', () => {
    const result = compareLatestQuotes(
      request,
      [
        quote({
          commercialTerms: null,
          deliveryDate: new Date('2027-01-12T00:00:00.000Z'),
          validUntil: new Date('2027-01-08T00:00:00.000Z'),
          items: [
            {
              ...quote().items[0]!,
              availableQuantity: '75',
              substitution: 'Roma tomato, same grade',
            },
            {
              ...quote().items[1]!,
              noQuote: true,
              availableQuantity: null,
              unit: null,
              unitRatePaise: null,
              gstBasisPoints: null,
              subtotalPaise: BigInt(0),
              gstPaise: BigInt(0),
              totalPaise: BigInt(0),
            },
          ],
        }),
      ],
      { now: new Date('2027-01-09T00:00:00.000Z') },
    );

    expect(result.quotes[0]).toMatchObject({
      coveredItemCount: 0,
      fullCoverage: false,
      comparable: false,
      deliveryFit: 'AFTER_REQUESTED_DATE',
      expired: true,
      missingTerms: true,
      missingRequestItemIds: ['coriander'],
      partialRequestItemIds: ['tomato'],
      substitutions: [
        {
          requestItemId: 'tomato',
          text: 'Roma tomato, same grade',
        },
      ],
    });
  });

  it('does not break or rank equal landed totals', () => {
    const result = compareLatestQuotes(
      request,
      [
        quote({ id: 'quote-b', supplierId: 'supplier-b', supplierName: 'Beta Foods' }),
        quote({ id: 'quote-a', supplierId: 'supplier-a', supplierName: 'Alpha Foods' }),
      ],
      { now: new Date('2027-01-09T00:00:00.000Z') },
    );

    expect(result.quotes.map(({ supplierName, totalPaise }) => [supplierName, totalPaise]))
      .toEqual([
        ['Alpha Foods', '8345000'],
        ['Beta Foods', '8345000'],
      ]);
    expect(result.quotes.every((entry) => !('rank' in entry))).toBe(true);
  });

  it('keeps inactive suppliers visible but makes their quotes explicitly unawardable', () => {
    const result = compareLatestQuotes(
      request,
      [quote({ supplierActive: false })],
      { now: new Date('2027-01-09T00:00:00.000Z') },
    );

    expect(result.quotes[0]).toMatchObject({
      comparable: true,
      supplierActive: false,
      awardable: false,
      awardIssues: ['SUPPLIER_INACTIVE'],
    });
  });

  it('explains every fact that prevents a whole-quote award', () => {
    const result = compareLatestQuotes(
      request,
      [
        quote({
          supplierActive: false,
          validUntil: new Date('2027-01-08T00:00:00.000Z'),
          items: [
            quote().items[0]!,
            {
              ...quote().items[1]!,
              noQuote: true,
              availableQuantity: null,
              unit: null,
              unitRatePaise: null,
              gstBasisPoints: null,
              subtotalPaise: BigInt(0),
              gstPaise: BigInt(0),
              totalPaise: BigInt(0),
            },
          ],
        }),
      ],
      { now: new Date('2027-01-09T00:00:00.000Z') },
    );

    expect(result.quotes[0]).toMatchObject({
      awardable: false,
      awardIssues: [
        'SUPPLIER_INACTIVE',
        'QUOTE_EXPIRED',
        'INCOMPLETE_COVERAGE',
      ],
    });
  });
});
