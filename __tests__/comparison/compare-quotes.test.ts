import {
  compareLatestQuotes,
  type ComparisonQuote,
  type ComparisonRequest,
} from '@/lib/comparison/compare-quotes';

const emptySpecification = {
  v: 1 as const,
  category: 'VEGETABLES' as const,
  description: null,
  preferredBrand: null,
  packSize: null,
  qualityGrade: null,
  notes: null,
  referenceUrl: null,
  thumbnailWebpBase64: null,
};

const request: ComparisonRequest = {
  id: 'request-a',
  title: 'Weekly produce',
  deliveryDate: '2027-01-10',
  quoteDeadline: '2027-01-09T10:00:00.000Z',
  commercialTerms: 'Payment in 15 days.',
  items: [
    {
      id: 'tomato',
      itemKey: 'tomato',
      name: 'Tomato',
      quantity: '100',
      unit: 'KILOGRAM',
      specification: {
        ...emptySpecification,
        preferredBrand: 'Farm Select',
        packSize: '10 kg crate',
        qualityGrade: 'A',
      },
    },
    {
      id: 'coriander',
      itemKey: 'coriander',
      name: 'Coriander',
      quantity: '10',
      unit: 'PACK',
      specification: emptySpecification,
    },
  ],
};

function quote(overrides: Partial<ComparisonQuote> = {}): ComparisonQuote {
  return {
    supplierRequestId: 'supplier-request-a',
    supplierName: 'Shakti Foods',
    supplierActive: true,
    eligibleRequestItemIds: ['tomato', 'coriander'],
    revision: 2,
    submittedAt: '2027-01-08T09:00:00.000Z',
    deliveryDate: '2027-01-10',
    validUntil: '2027-01-11',
    minimumOrder: 'Minimum invoice ₹2,500',
    freightPaise: '50000',
    commercialTerms: 'Payment in 15 days.',
    notes: null,
    subtotalPaise: '7900000',
    gstPaise: '395000',
    totalPaise: '8345000',
    items: [
      {
        requestItemId: 'tomato',
        noQuote: false,
        availableQuantity: '100',
        unit: 'KILOGRAM',
        unitRatePaise: '70000',
        gstBasisPoints: 500,
        taxInclusive: false,
        suppliedBrand: 'Market Fresh',
        suppliedPackSize: '5 kg crate',
        suppliedQualityGrade: 'B',
        substitution: 'Roma tomato',
        subtotalPaise: '7000000',
        gstPaise: '350000',
        totalPaise: '7350000',
      },
      {
        requestItemId: 'coriander',
        noQuote: false,
        availableQuantity: '10',
        unit: 'PACK',
        unitRatePaise: '90000',
        gstBasisPoints: 500,
        taxInclusive: false,
        suppliedBrand: null,
        suppliedPackSize: null,
        suppliedQualityGrade: null,
        substitution: null,
        subtotalPaise: '900000',
        gstPaise: '45000',
        totalPaise: '945000',
      },
    ],
    ...overrides,
  };
}

describe('factual embedded quote comparison', () => {
  it('shows landed/commercial facts and requested-versus-supplied specifications without ranking', () => {
    const result = compareLatestQuotes(request, [quote()], {
      now: new Date('2027-01-09T00:00:00.000Z'),
    });

    expect(result.request).toMatchObject({ id: 'request-a', itemCount: 2 });
    expect(result.quotes[0]).toMatchObject({
      supplierRequestId: 'supplier-request-a',
      supplierName: 'Shakti Foods',
      revision: 2,
      minimumOrder: 'Minimum invoice ₹2,500',
      totalPaise: '8345000',
      coveredItemCount: 2,
      fullCoverage: true,
      deliveryFit: 'ON_OR_BEFORE',
      expired: false,
      missingTerms: false,
      substitutions: [{ requestItemId: 'tomato', text: 'Roma tomato' }],
    });
    expect(result.quotes[0]?.items[0]).toMatchObject({
      requestedSpecification: {
        preferredBrand: 'Farm Select',
        packSize: '10 kg crate',
        qualityGrade: 'A',
      },
      suppliedSpecification: {
        brand: 'Market Fresh',
        packSize: '5 kg crate',
        qualityGrade: 'B',
      },
    });
    for (const forbidden of [
      'score', 'winner', 'recommendation', 'recommended', 'cheapest',
      'savings', 'rank', 'awardable', 'supplierId', 'quoteId',
    ]) {
      expect(JSON.stringify(result)).not.toContain(`"${forbidden}"`);
    }
  });

  it('sorts equal-price quotes only by business name then SupplierRequest ID', () => {
    const result = compareLatestQuotes(request, [
      quote({ supplierRequestId: 'sr-z', supplierName: 'Beta Foods' }),
      quote({ supplierRequestId: 'sr-b', supplierName: 'Alpha Foods' }),
      quote({ supplierRequestId: 'sr-a', supplierName: 'Alpha Foods' }),
    ], { now: new Date('2027-01-09T00:00:00.000Z') });

    expect(result.quotes.map(({ supplierName, supplierRequestId, totalPaise }) => [
      supplierName,
      supplierRequestId,
      totalPaise,
    ])).toEqual([
      ['Alpha Foods', 'sr-a', '8345000'],
      ['Alpha Foods', 'sr-b', '8345000'],
      ['Beta Foods', 'sr-z', '8345000'],
    ]);
  });

  it('keeps PACK/CASE/CRATE incomparable without an explicit conversion', () => {
    const result = compareLatestQuotes(request, [quote({
      items: [
        quote().items[0]!,
        { ...quote().items[1]!, unit: 'CASE' },
      ],
    })], { now: new Date('2027-01-09T00:00:00.000Z') });

    expect(result.quotes[0]?.items[1]).toMatchObject({
      requestUnit: 'PACK',
      quotedUnit: 'CASE',
      normalizedAvailableQuantity: null,
      normalizedUnitRatePaise: null,
      unitComparable: false,
      coverage: 'UNIT_MISMATCH',
    });
    expect(result.quotes[0]).toMatchObject({
      fullCoverage: false,
      unitMismatchRequestItemIds: ['coriander'],
    });
  });

  it('does not count items outside a supplier invitation as missing coverage', () => {
    const scopedQuote = quote({
      eligibleRequestItemIds: ['tomato'],
      items: [quote().items[0]!],
    });
    const result = compareLatestQuotes(request, [scopedQuote], {
      now: new Date('2027-01-09T00:00:00.000Z'),
    });

    expect(result.quotes[0]).toMatchObject({
      coveredItemCount: 1,
      totalItemCount: 1,
      fullCoverage: true,
      missingRequestItemIds: [],
    });
    expect(result.quotes[0]?.items[1]).toMatchObject({
      requestItemId: 'coriander',
      coverage: 'NOT_REQUESTED',
    });
  });

  it('keeps missing-subset, partial, no-quote, substitution, validity, delivery, and terms facts visible', () => {
    const result = compareLatestQuotes(request, [quote({
      commercialTerms: null,
      deliveryDate: '2027-01-12',
      validUntil: '2027-01-08',
      items: [
        {
          ...quote().items[0]!,
          availableQuantity: '75',
          substitution: 'Roma tomato, same grade',
        },
      ],
    })], { now: new Date('2027-01-09T00:00:00.000Z') });

    expect(result.quotes[0]).toMatchObject({
      coveredItemCount: 0,
      fullCoverage: false,
      deliveryFit: 'AFTER_REQUESTED_DATE',
      expired: true,
      missingTerms: true,
      missingRequestItemIds: ['coriander'],
      partialRequestItemIds: ['tomato'],
      substitutions: [
        { requestItemId: 'tomato', text: 'Roma tomato, same grade' },
      ],
    });
  });
});
