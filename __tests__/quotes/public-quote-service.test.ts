import {
  assertPublicQuoteTenantItemCapacity,
  nextPublicQuoteRevision,
  PUBLIC_QUOTE_MAX_REVISIONS,
  PUBLIC_QUOTE_TENANT_ITEM_LIMIT,
  PublicQuoteCapacityError,
  PublicQuoteRevisionLimitError,
  PublicQuoteValidationError,
  validatePublicQuoteSubmission,
} from '@/lib/quotes/public-quote-service';

const now = new Date('2026-08-28T10:00:00.000Z');
const requestItems = [
  { id: 'tomato', name: 'Tomato', quantity: '100', unit: 'KILOGRAM' as const },
  { id: 'paneer', name: 'Paneer', quantity: '25.5', unit: 'KILOGRAM' as const },
  { id: 'mint', name: 'Mint', quantity: '10', unit: 'KILOGRAM' as const },
];

function validSubmission() {
  return {
    expectedLatestRevision: 0,
    deliveryDate: '2026-09-02',
    validUntil: '2026-09-01',
    freightInr: '450.00',
    commercialTerms: 'Payment within 15 days',
    notes: null,
    items: [
      {
        requestItemId: 'tomato',
        noQuote: false,
        availableQuantity: '100',
        unitRateInr: '42.00',
        gstPercent: '5',
        taxInclusive: false,
        substitution: null,
      },
      {
        requestItemId: 'paneer',
        noQuote: false,
        availableQuantity: '25.5',
        unitRateInr: '320',
        gstPercent: '5',
        taxInclusive: true,
        substitution: 'Fresh paneer, 1 kg packs',
      },
      { requestItemId: 'mint', noQuote: true },
    ],
  };
}

describe('public supplier quote validation and totals', () => {
  it('places a hard storage bound on immutable quote revisions', () => {
    expect(PUBLIC_QUOTE_MAX_REVISIONS).toBe(10);
    expect(nextPublicQuoteRevision(PUBLIC_QUOTE_MAX_REVISIONS - 1)).toBe(
      PUBLIC_QUOTE_MAX_REVISIONS,
    );
    expect(() => nextPublicQuoteRevision(PUBLIC_QUOTE_MAX_REVISIONS)).toThrow(
      PublicQuoteRevisionLimitError,
    );
  });

  it('fails closed before a restaurant exceeds its quote-line storage budget', () => {
    expect(() =>
      assertPublicQuoteTenantItemCapacity(
        PUBLIC_QUOTE_TENANT_ITEM_LIMIT - requestItems.length,
        requestItems.length,
      ),
    ).not.toThrow();
    expect(() =>
      assertPublicQuoteTenantItemCapacity(
        PUBLIC_QUOTE_TENANT_ITEM_LIMIT - requestItems.length + 1,
        requestItems.length,
      ),
    ).toThrow(PublicQuoteCapacityError);
  });


  it('calculates India GST and landed totals only on the server', () => {
    const result = validatePublicQuoteSubmission(
      validSubmission(),
      requestItems,
      now,
    );

    expect(result).toEqual(
      expect.objectContaining({
        expectedLatestRevision: 0,
        freightPaise: BigInt(45_000),
        subtotalPaise: BigInt(1_197_143),
        gstPaise: BigInt(59_857),
        totalPaise: BigInt(1_302_000),
        commercialTerms: 'Payment within 15 days',
        notes: null,
      }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        requestItemId: 'tomato',
        availableQuantity: '100',
        unitRatePaise: BigInt(4_200),
        gstBasisPoints: 500,
        subtotalPaise: BigInt(420_000),
        gstPaise: BigInt(21_000),
        totalPaise: BigInt(441_000),
      }),
      expect.objectContaining({
        requestItemId: 'paneer',
        availableQuantity: '25.5',
        unitRatePaise: BigInt(32_000),
        gstBasisPoints: 500,
        taxInclusive: true,
        subtotalPaise: BigInt(777_143),
        gstPaise: BigInt(38_857),
        totalPaise: BigInt(816_000),
      }),
      {
        requestItemId: 'mint',
        noQuote: true,
        availableQuantity: null,
        unit: null,
        unitRatePaise: null,
        gstBasisPoints: null,
        taxInclusive: false,
        substitution: null,
        subtotalPaise: BigInt(0),
        gstPaise: BigInt(0),
        totalPaise: BigInt(0),
      },
    ]);
  });

  it('requires every request item exactly once and rejects client totals', () => {
    for (const items of [
      validSubmission().items.slice(0, 2),
      [...validSubmission().items, validSubmission().items[0]],
      [
        ...validSubmission().items.slice(0, 2),
        { requestItemId: 'not-in-request', noQuote: true },
      ],
    ]) {
      expect(() =>
        validatePublicQuoteSubmission(
          { ...validSubmission(), items },
          requestItems,
          now,
        ),
      ).toThrow(PublicQuoteValidationError);
    }

    const tampered = validSubmission();
    Object.assign(tampered.items[0]!, { totalPaise: '1' });
    expect(() =>
      validatePublicQuoteSubmission(tampered, requestItems, now),
    ).toThrow(PublicQuoteValidationError);
  });

  it('bounds quantities, dates, rates, GST, text, and no-quote fields', () => {
    const cases: unknown[] = [];
    const tooMuch = validSubmission();
    tooMuch.items[0]!.availableQuantity = '100.001';
    cases.push(tooMuch);

    const oldDelivery = validSubmission();
    oldDelivery.deliveryDate = '2026-08-27';
    cases.push(oldDelivery);

    const badGst = validSubmission();
    badGst.items[0]!.gstPercent = '100.01';
    cases.push(badGst);

    const noQuotePrice = validSubmission();
    Object.assign(noQuotePrice.items[2]!, { unitRateInr: '12' });
    cases.push(noQuotePrice);

    const oversizedNotes = validSubmission();
    Object.assign(oversizedNotes, { notes: '₹'.repeat(2_000) });
    cases.push(oversizedNotes);

    for (const candidate of cases) {
      expect(() =>
        validatePublicQuoteSubmission(candidate, requestItems, now),
      ).toThrow(PublicQuoteValidationError);
    }

    const prototypeKey = JSON.parse(
      JSON.stringify({ ...validSubmission(), __proto_marker__: true }).replace(
        '__proto_marker__',
        '__proto__',
      ),
    );
    expect(() =>
      validatePublicQuoteSubmission(prototypeKey, requestItems, now),
    ).toThrow(PublicQuoteValidationError);
  });
});
