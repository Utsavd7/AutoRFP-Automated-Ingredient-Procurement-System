import {
  AWARD_SUPPLIER_SNAPSHOTS_BYTES,
  assertAwardSupplierSnapshotsSize,
  AwardSnapshotTooLargeError,
  AwardValidationError,
  validateAwardInput,
} from '@/lib/awards/award-service';

describe('award input', () => {
  it('preflights supplier snapshots at the same 2 MiB boundary enforced by PostgreSQL', () => {
    const compactSuppliers = Array.from({ length: 100 }, (_, index) => ({
      supplierId: `supplier-${index}`,
      supplierName: `Supplier ${index} ${'N'.repeat(120)}`,
      contactName: `Contact ${index} ${'C'.repeat(80)}`,
      addressLine: `${index}, ${'Market Road '.repeat(18)}`,
      city: 'Bengaluru',
      state: 'Karnataka',
      pin: '560038',
      freightPaise: '0',
    }));

    expect(() => assertAwardSupplierSnapshotsSize(compactSuppliers)).not.toThrow();
    expect(
      new TextEncoder().encode(JSON.stringify(compactSuppliers)).byteLength,
    ).toBeGreaterThan(16_384);
    expect(
      new TextEncoder().encode(JSON.stringify(compactSuppliers)).byteLength,
    ).toBeLessThan(AWARD_SUPPLIER_SNAPSHOTS_BYTES);
    expect(() =>
      assertAwardSupplierSnapshotsSize([
        { supplierId: 'too-large', supplierName: '₹'.repeat(700_000) },
      ]),
    ).toThrow(AwardSnapshotTooLargeError);
  });

  it('accepts a bounded whole-basket human decision', () => {
    expect(
      validateAwardInput({
        mode: 'WHOLE',
        expectedRequestVersion: 2,
        supplierQuoteId: 'quote-a',
        rationale: 'Best complete landed cost with delivery on the requested date.',
      }),
    ).toEqual({
      mode: 'WHOLE',
      expectedRequestVersion: 2,
      supplierQuoteId: 'quote-a',
      rationale: 'Best complete landed cost with delivery on the requested date.',
    });
  });

  it('accepts split quantities but never accepts client totals, tax, supplier, or tenant fields', () => {
    expect(
      validateAwardInput({
        mode: 'SPLIT',
        expectedRequestVersion: 2,
        rationale: 'Split for complete stock coverage and one delivery window.',
        selections: [
          {
            requestItemId: 'tomato',
            supplierQuoteItemId: 'quote-item-a',
            quantity: '75',
          },
          {
            requestItemId: 'tomato',
            supplierQuoteItemId: 'quote-item-b',
            quantity: '25',
          },
        ],
      }),
    ).toMatchObject({ mode: 'SPLIT', selections: expect.any(Array) });

    for (const forbidden of ['tenantId', 'totalPaise', 'gstPaise', 'supplierId']) {
      expect(() =>
        validateAwardInput({
          mode: 'WHOLE',
          expectedRequestVersion: 2,
          supplierQuoteId: 'quote-a',
          rationale: 'Human decision.',
          [forbidden]: 'client-controlled',
        }),
      ).toThrow(AwardValidationError);
    }
  });

  it('requires an explicit human rationale and rejects duplicate or unbounded selections', () => {
    expect(() =>
      validateAwardInput({
        mode: 'WHOLE',
        expectedRequestVersion: 2,
        supplierQuoteId: 'quote-a',
        rationale: '',
      }),
    ).toThrow(AwardValidationError);

    expect(() =>
      validateAwardInput({
        mode: 'SPLIT',
        expectedRequestVersion: 2,
        rationale: 'Complete coverage.',
        selections: [
          {
            requestItemId: 'tomato',
            supplierQuoteItemId: 'quote-item-a',
            quantity: '50',
          },
          {
            requestItemId: 'tomato',
            supplierQuoteItemId: 'quote-item-a',
            quantity: '50',
          },
        ],
      }),
    ).toThrow(AwardValidationError);

    expect(() =>
      validateAwardInput({
        mode: 'SPLIT',
        expectedRequestVersion: 2,
        rationale: 'Complete coverage.',
        selections: [],
      }),
    ).toThrow(AwardValidationError);
  });

  it('rejects malformed versions, quantities, identifiers, and unknown nested fields', () => {
    const invalid = [
      {
        mode: 'WHOLE',
        expectedRequestVersion: 0,
        supplierQuoteId: 'quote-a',
        rationale: 'Human decision.',
      },
      {
        mode: 'SPLIT',
        expectedRequestVersion: 2,
        rationale: 'Human decision.',
        selections: [
          {
            requestItemId: 'tomato',
            supplierQuoteItemId: 'quote-item-a',
            quantity: '1.0001',
          },
        ],
      },
      {
        mode: 'SPLIT',
        expectedRequestVersion: 2,
        rationale: 'Human decision.',
        selections: [
          {
            requestItemId: 'tomato',
            supplierQuoteItemId: 'quote-item-a',
            quantity: '1',
            unitRatePaise: '1',
          },
        ],
      },
    ];

    for (const input of invalid) {
      expect(() => validateAwardInput(input)).toThrow(AwardValidationError);
    }
  });
});
