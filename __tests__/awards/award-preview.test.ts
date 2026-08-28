import { calculateSplitAwardPreview } from '@/lib/awards/award-preview';

const requestItems = [
  { id: 'tomato', name: 'Tomato', quantity: '100', unit: 'KILOGRAM' },
];

const quotes = [
  {
    quoteId: 'quote-a',
    supplierId: 'supplier-a',
    supplierName: 'A Produce',
    freightPaise: '10000',
    expired: false,
    supplierActive: true,
    awardable: true,
    items: [
      {
        requestItemId: 'tomato', quoteItemId: 'line-a',
        normalizedAvailableQuantity: '60', normalizedUnitRatePaise: '5000',
        gstBasisPoints: 500, taxInclusive: false, unitComparable: true,
      },
    ],
  },
  {
    quoteId: 'quote-b',
    supplierId: 'supplier-b',
    supplierName: 'B Produce',
    freightPaise: '20000',
    expired: false,
    supplierActive: true,
    awardable: true,
    items: [
      {
        requestItemId: 'tomato', quoteItemId: 'line-b',
        normalizedAvailableQuantity: '100', normalizedUnitRatePaise: '5500',
        gstBasisPoints: 500, taxInclusive: false, unitComparable: true,
      },
    ],
  },
];

describe('split award preview', () => {
  it('covers one item across suppliers and adds each selected freight charge once', () => {
    expect(calculateSplitAwardPreview({
      requestItems,
      quotes,
      allocations: {
        tomato: [
          { quoteItemId: 'line-a', quantity: '60' },
          { quoteItemId: 'line-b', quantity: '40' },
        ],
      },
    })).toMatchObject({
      ready: true,
      subtotalPaise: '520000',
      gstPaise: '26000',
      freightPaise: '30000',
      totalPaise: '576000',
      selectedQuoteIds: ['quote-a', 'quote-b'],
      selections: [
        { requestItemId: 'tomato', supplierQuoteItemId: 'line-a', quantity: '60' },
        { requestItemId: 'tomato', supplierQuoteItemId: 'line-b', quantity: '40' },
      ],
    });
  });

  it('reports exact remaining quantity and refuses under, over, unavailable, or inactive coverage', () => {
    const under = calculateSplitAwardPreview({
      requestItems,
      quotes,
      allocations: { tomato: [{ quoteItemId: 'line-a', quantity: '59.5' }] },
    });
    expect(under.ready).toBe(false);
    expect(under.itemCoverage.tomato).toEqual({
      requested: '100', allocated: '59.5', remaining: '40.5', valid: false,
    });

    expect(calculateSplitAwardPreview({
      requestItems,
      quotes,
      allocations: { tomato: [{ quoteItemId: 'line-a', quantity: '61' }] },
    }).errors).toContain('A Produce can supply at most 60 kg for Tomato.');

    expect(calculateSplitAwardPreview({
      requestItems,
      quotes: [{ ...quotes[0], supplierActive: false, awardable: false }],
      allocations: { tomato: [{ quoteItemId: 'line-a', quantity: '60' }] },
    }).errors).toContain('A Produce is not available for an award.');
  });

  it('uses GST-inclusive arithmetic exactly like the award service', () => {
    const result = calculateSplitAwardPreview({
      requestItems: [{ ...requestItems[0], quantity: '2.5' }],
      quotes: [{
        ...quotes[0], freightPaise: '50',
        items: [{ ...quotes[0].items[0], normalizedAvailableQuantity: '2.5', normalizedUnitRatePaise: '11800', gstBasisPoints: 1800, taxInclusive: true }],
      }],
      allocations: { tomato: [{ quoteItemId: 'line-a', quantity: '2.5' }] },
    });
    expect(result).toMatchObject({
      ready: true,
      subtotalPaise: '25000',
      gstPaise: '4500',
      freightPaise: '50',
      totalPaise: '29550',
    });
  });
});
