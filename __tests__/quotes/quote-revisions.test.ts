import {
  appendQuoteRevision,
  EMPTY_QUOTE_REVISIONS,
  PUBLIC_QUOTE_DOCUMENT_BYTES,
  PUBLIC_QUOTE_MAX_ITEMS,
  PUBLIC_QUOTE_MAX_REVISIONS,
  PublicQuoteDocumentSizeError,
  PublicQuoteRevisionConflictError,
  PublicQuoteRevisionLimitError,
  PublicQuoteStorageCorruptionError,
  PublicQuoteValidationError,
  type QuoteRequestItem,
  type QuoteRevisionsV1,
} from '@/lib/quotes/quote-revisions';

const databaseNow = new Date('2026-08-28T10:00:00.123Z');
const requestItems: QuoteRequestItem[] = [
  {
    id: 'tomato',
    itemKey: 'tomato',
    name: 'Tomato',
    quantity: '100',
    unit: 'KILOGRAM',
    specification: {
      v: 1,
      category: 'VEGETABLES',
      description: 'Firm red tomatoes',
      preferredBrand: 'Farm Select',
      packSize: '10 kg crate',
      qualityGrade: 'A',
      notes: null,
      referenceUrl: null,
      thumbnailWebpBase64: null,
    },
  },
  {
    id: 'paneer',
    itemKey: 'paneer',
    name: 'Paneer',
    quantity: '25.5',
    unit: 'KILOGRAM',
    specification: {
      v: 1,
      category: 'DAIRY',
      description: null,
      preferredBrand: null,
      packSize: null,
      qualityGrade: null,
      notes: null,
      referenceUrl: null,
      thumbnailWebpBase64: null,
    },
  },
  {
    id: 'mint',
    itemKey: 'mint',
    name: 'Mint',
    quantity: '10',
    unit: 'KILOGRAM',
    specification: {
      v: 1,
      category: 'VEGETABLES',
      description: null,
      preferredBrand: null,
      packSize: null,
      qualityGrade: null,
      notes: null,
      referenceUrl: null,
      thumbnailWebpBase64: null,
    },
  },
];

function submission() {
  return {
    deliveryDate: '2026-09-02',
    validUntil: '2026-09-01',
    minimumOrder: 'Minimum invoice ₹2,500',
    freightInr: '450.00',
    commercialTerms: 'Payment within 15 days',
    notes: null,
    items: [
      {
        requestItemId: 'paneer',
        noQuote: false,
        availableQuantity: '25.5',
        unit: 'KILOGRAM',
        unitRateInr: '320',
        gstPercent: '5',
        taxInclusive: true,
        suppliedBrand: 'Dairy House',
        suppliedPackSize: '1 kg vacuum pack',
        suppliedQualityGrade: 'Premium',
        substitution: 'Fresh paneer',
      },
      {
        requestItemId: 'tomato',
        noQuote: false,
        availableQuantity: '100.000',
        unit: 'KILOGRAM',
        unitRateInr: '42.00',
        gstPercent: '5.00',
        taxInclusive: false,
        suppliedBrand: 'Farm Select',
        suppliedPackSize: '10 kg crate',
        suppliedQualityGrade: 'A',
        substitution: null,
      },
      {
        requestItemId: 'mint',
        noQuote: true,
        availableQuantity: '9',
        unit: 'KILOGRAM',
        unitRateInr: '12',
        gstPercent: '18',
        taxInclusive: true,
        suppliedBrand: 'Ignored brand',
        suppliedPackSize: 'Ignored pack',
        suppliedQualityGrade: 'Ignored grade',
        substitution: 'Ignored substitution',
      },
    ],
  };
}

function append(
  document: unknown = EMPTY_QUOTE_REVISIONS,
  input: unknown = submission(),
  overrides: Partial<Parameters<typeof appendQuoteRevision>[2]> = {},
) {
  return appendQuoteRevision(document, input, {
    requestItems,
    expectedLatestRevision: 0,
    storedLatestRevision: 0,
    databaseNow,
    ...overrides,
  });
}

function databaseJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('QuoteRevisionsV1', () => {
  it('canonicalizes exact INR, quantity, GST, totals, supplied facts, and request order', () => {
    const document = append();

    expect(document).toEqual({
      v: 1,
      revisions: [
        {
          revision: 1,
          submittedAt: '2026-08-28T10:00:00.123Z',
          deliveryDate: '2026-09-02',
          validUntil: '2026-09-01',
          minimumOrder: 'Minimum invoice ₹2,500',
          freightPaise: '45000',
          commercialTerms: 'Payment within 15 days',
          notes: null,
          items: [
            {
              requestItemId: 'tomato',
              noQuote: false,
              availableQuantity: '100',
              unit: 'KILOGRAM',
              unitRatePaise: '4200',
              gstBasisPoints: 500,
              taxInclusive: false,
              suppliedBrand: 'Farm Select',
              suppliedPackSize: '10 kg crate',
              suppliedQualityGrade: 'A',
              substitution: null,
              subtotalPaise: '420000',
              gstPaise: '21000',
              totalPaise: '441000',
            },
            {
              requestItemId: 'paneer',
              noQuote: false,
              availableQuantity: '25.5',
              unit: 'KILOGRAM',
              unitRatePaise: '32000',
              gstBasisPoints: 500,
              taxInclusive: true,
              suppliedBrand: 'Dairy House',
              suppliedPackSize: '1 kg vacuum pack',
              suppliedQualityGrade: 'Premium',
              substitution: 'Fresh paneer',
              subtotalPaise: '777143',
              gstPaise: '38857',
              totalPaise: '816000',
            },
            {
              requestItemId: 'mint',
              noQuote: true,
              availableQuantity: null,
              unit: null,
              unitRatePaise: null,
              gstBasisPoints: null,
              taxInclusive: false,
              suppliedBrand: null,
              suppliedPackSize: null,
              suppliedQualityGrade: null,
              substitution: null,
              subtotalPaise: '0',
              gstPaise: '0',
              totalPaise: '0',
            },
          ],
          subtotalPaise: '1197143',
          gstPaise: '59857',
          totalPaise: '1302000',
        },
      ],
    });

    const numericMoney = submission();
    Object.assign(numericMoney, { freightInr: 450 });
    Object.assign(numericMoney.items[0]!, {
      availableQuantity: 25,
      unitRateInr: 320,
      gstPercent: 5,
    });
    expect(() => append(EMPTY_QUOTE_REVISIONS, numericMoney)).toThrow(
      PublicQuoteValidationError,
    );
  });

  it('uses only the database clock, rejects a client timestamp, and leaves prior documents immutable', () => {
    const original = databaseJson(EMPTY_QUOTE_REVISIONS);
    const withTimestamp = { ...submission(), submittedAt: '1999-01-01T00:00:00.000Z' };

    expect(() => append(original, withTimestamp)).toThrow(PublicQuoteValidationError);
    expect(append(original).revisions[0]?.submittedAt).toBe(databaseNow.toISOString());
    expect(original).toEqual(EMPTY_QUOTE_REVISIONS);
  });

  it.each([
    ['missing item', () => ({ ...submission(), items: submission().items.slice(0, 2) })],
    ['duplicate item', () => ({ ...submission(), items: [...submission().items, submission().items[0]] })],
    ['unrelated item', () => ({ ...submission(), items: [...submission().items.slice(0, 2), { requestItemId: 'other', noQuote: true }] })],
    ['wrong unit', () => ({ ...submission(), items: submission().items.map((item) => item.requestItemId === 'tomato' ? { ...item, unit: 'GRAM' } : item) })],
    ['client total', () => ({ ...submission(), items: submission().items.map((item) => item.requestItemId === 'tomato' ? { ...item, totalPaise: '1' } : item) })],
    ['quantity above request', () => ({ ...submission(), items: submission().items.map((item) => item.requestItemId === 'tomato' ? { ...item, availableQuantity: '100.001' } : item) })],
  ])('rejects %s', (_label, candidate) => {
    expect(() => append(EMPTY_QUOTE_REVISIONS, candidate())).toThrow(
      PublicQuoteValidationError,
    );
  });

  it('rejects unknown keys, non-plain objects, accessors, and prototype-pollution keys', () => {
    const accessor = submission();
    Object.defineProperty(accessor, 'notes', {
      enumerable: true,
      get: () => 'secret',
    });
    const polluted = JSON.parse(
      JSON.stringify({ ...submission(), __prototype_marker__: true }).replace(
        '__prototype_marker__',
        '__proto__',
      ),
    );

    for (const candidate of [
      { ...submission(), unexpected: true },
      Object.assign(Object.create(null), submission()),
      accessor,
      polluted,
    ]) {
      expect(() => append(EMPTY_QUOTE_REVISIONS, candidate)).toThrow(
        PublicQuoteValidationError,
      );
    }
  });

  it('accepts exactly 250 eligible items and rejects a larger eligible subset', () => {
    const items = Array.from({ length: PUBLIC_QUOTE_MAX_ITEMS }, (_, index) => ({
      ...requestItems[0]!,
      id: `item-${index}`,
      itemKey: `item-${index}`,
      name: `Item ${index}`,
      quantity: '1',
    }));
    const quote = {
      ...submission(),
      minimumOrder: null,
      items: items.map((item) => ({ requestItemId: item.id, noQuote: true })),
    };

    expect(appendQuoteRevision(EMPTY_QUOTE_REVISIONS, quote, {
      requestItems: items,
      expectedLatestRevision: 0,
      storedLatestRevision: 0,
      databaseNow,
    }).revisions[0]?.items).toHaveLength(PUBLIC_QUOTE_MAX_ITEMS);
    expect(() => appendQuoteRevision(EMPTY_QUOTE_REVISIONS, {
      ...quote,
      items: [...quote.items, { requestItemId: 'item-250', noQuote: true }],
    }, {
      requestItems: [...items, { ...items[0]!, id: 'item-250', itemKey: 'item-250' }],
      expectedLatestRevision: 0,
      storedLatestRevision: 0,
      databaseNow,
    })).toThrow(PublicQuoteStorageCorruptionError);
  });

  it('validates every prior revision and scalar before reporting a stale client revision', () => {
    const first = append();
    const corrupted = databaseJson(first) as QuoteRevisionsV1;
    corrupted.revisions[0]!.totalPaise = '1';

    expect(() => append(corrupted, submission(), {
      expectedLatestRevision: 9,
      storedLatestRevision: 1,
    })).toThrow(PublicQuoteStorageCorruptionError);
    expect(() => append(first, submission(), {
      expectedLatestRevision: 0,
      storedLatestRevision: 2,
    })).toThrow(PublicQuoteStorageCorruptionError);
    expect(() => append(first, submission(), {
      expectedLatestRevision: 0,
      storedLatestRevision: 1,
    })).toThrow(PublicQuoteRevisionConflictError);
  });

  it('allows ten contiguous revisions, then reports revision exhaustion distinctly', () => {
    let document: QuoteRevisionsV1 = databaseJson(EMPTY_QUOTE_REVISIONS);
    for (let revision = 0; revision < PUBLIC_QUOTE_MAX_REVISIONS; revision += 1) {
      document = append(document, submission(), {
        expectedLatestRevision: revision,
        storedLatestRevision: revision,
      });
    }

    expect(document.revisions.map(({ revision }) => revision)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    expect(() => append(document, submission(), {
      expectedLatestRevision: 10,
      storedLatestRevision: 10,
    })).toThrow(PublicQuoteRevisionLimitError);
  });

  it('reports the two-MiB document limit independently of the revision limit', () => {
    const items = Array.from({ length: PUBLIC_QUOTE_MAX_ITEMS }, (_, index) => ({
      ...requestItems[0]!,
      id: `large-${index}`,
      itemKey: `large-${index}`,
      name: `Large ${index}`,
      quantity: '1',
    }));
    const largeSubmission = {
      ...submission(),
      minimumOrder: 'm'.repeat(500),
      commercialTerms: 'c'.repeat(2_000),
      notes: 'n'.repeat(4_000),
      items: items.map((item) => ({
        requestItemId: item.id,
        noQuote: false,
        availableQuantity: '1',
        unit: 'KILOGRAM',
        unitRateInr: '1',
        gstPercent: '0',
        taxInclusive: false,
        suppliedBrand: 'b'.repeat(120),
        suppliedPackSize: 'p'.repeat(120),
        suppliedQualityGrade: 'q'.repeat(120),
        substitution: 's'.repeat(500),
      })),
    };
    let document: QuoteRevisionsV1 = databaseJson(EMPTY_QUOTE_REVISIONS);
    let caught: unknown;
    for (let revision = 0; revision < PUBLIC_QUOTE_MAX_REVISIONS; revision += 1) {
      try {
        document = appendQuoteRevision(document, largeSubmission, {
          requestItems: items,
          expectedLatestRevision: revision,
          storedLatestRevision: revision,
          databaseNow,
        });
      } catch (error) {
        caught = error;
        break;
      }
    }

    expect(PUBLIC_QUOTE_DOCUMENT_BYTES).toBe(2 * 1024 * 1024);
    expect(caught).toBeInstanceOf(PublicQuoteDocumentSizeError);
    expect(document.revisions.length).toBeLessThan(PUBLIC_QUOTE_MAX_REVISIONS);
  });
});
