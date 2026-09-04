import {
  buildReceivingSummary,
  ReceivingStorageCorruptionError,
  ReceivingValidationError,
  validateReceivingInput,
  validateStoredReceiving,
} from '@/lib/receiving/receiving-document';

const matched = {
  supplierId: 'supplier-a',
  outcome: 'MATCHED',
  invoiceTotalPaise: '3025000',
  issueCodes: [],
  note: null,
} as const;
const matchedInput = { ...matched, expectedCheckedAt: null } as const;

describe('award receiving documents', () => {
  it('accepts a compact delivery check and starts empty when no check is stored', () => {
    expect(validateReceivingInput(matchedInput)).toEqual(matchedInput);
    expect(validateStoredReceiving(null)).toEqual({ v: 1, suppliers: [] });
  });

  it('accepts a problem with known issue codes and a bounded note', () => {
    expect(validateReceivingInput({
      ...matchedInput,
      outcome: 'ISSUES',
      issueCodes: ['LATE', 'PRICE_DIFFERENCE'],
      note: 'Invoice includes an extra delivery charge.',
    })).toEqual({
      ...matchedInput,
      outcome: 'ISSUES',
      issueCodes: ['LATE', 'PRICE_DIFFERENCE'],
      note: 'Invoice includes an extra delivery charge.',
    });
  });

  it.each([
    { ...matchedInput, tenantId: 'tenant-a' },
    { ...matchedInput, supplierId: '' },
    { ...matchedInput, outcome: 'ISSUES', issueCodes: [] },
    { ...matchedInput, outcome: 'MATCHED', issueCodes: ['LATE'] },
    { ...matchedInput, outcome: 'ISSUES', issueCodes: ['UNKNOWN'] },
    { ...matchedInput, invoiceTotalPaise: '0' },
    { ...matchedInput, invoiceTotalPaise: '30.25' },
    { ...matchedInput, note: 'x'.repeat(501) },
    { ...matchedInput, expectedCheckedAt: 'yesterday' },
  ])('rejects invalid or client-derived input', (candidate) => {
    expect(() => validateReceivingInput(candidate)).toThrow(
      ReceivingValidationError,
    );
  });

  it('validates exact stored entries and rejects duplicates or corrupt documents', () => {
    const stored = {
      v: 1,
      suppliers: [{
        ...matched,
        checkedAt: '2026-09-04T10:20:30.000Z',
      }],
    };
    expect(validateStoredReceiving(JSON.parse(JSON.stringify(stored)))).toEqual(stored);

    expect(() => validateStoredReceiving({
      ...stored,
      suppliers: [stored.suppliers[0], { ...stored.suppliers[0] }],
    })).toThrow(ReceivingStorageCorruptionError);
    expect(() => validateStoredReceiving({ ...stored, extra: true })).toThrow(
      ReceivingStorageCorruptionError,
    );
    expect(() => validateStoredReceiving({
      ...stored,
      suppliers: [{ ...stored.suppliers[0], checkedAt: 'yesterday' }],
    })).toThrow(ReceivingStorageCorruptionError);
  });

  it('derives expected supplier totals, invoice differences, completion, and problems', () => {
    const summary = buildReceivingSummary({
      allocationLines: {
        v: 1,
        lines: [
          { supplierId: 'supplier-a', totalPaise: '100000' },
          { supplierId: 'supplier-a', totalPaise: '25000' },
          { supplierId: 'supplier-b', totalPaise: '90000' },
        ],
      },
      supplierSnapshots: {
        v: 1,
        suppliers: [
          { supplierId: 'supplier-a', supplierName: 'A Foods', freightPaise: '5000', deliveryDate: '2026-09-04' },
          { supplierId: 'supplier-b', supplierName: 'B Foods', freightPaise: '0', deliveryDate: '2026-09-05' },
        ],
      },
      receiving: {
        v: 1,
        suppliers: [{
          ...matched,
          issueCodes: [],
          invoiceTotalPaise: '133000',
          checkedAt: '2026-09-04T10:20:30.000Z',
        }],
      },
    });

    expect(summary).toEqual({
      checkedCount: 1,
      totalCount: 2,
      complete: false,
      problemCount: 1,
      suppliers: [
        {
          supplierId: 'supplier-a', supplierName: 'A Foods', deliveryDate: '2026-09-04',
          expectedTotalPaise: '130000',
          check: {
            ...matched,
            invoiceTotalPaise: '133000', differencePaise: '3000', hasProblem: true,
            checkedAt: '2026-09-04T10:20:30.000Z',
          },
        },
        {
          supplierId: 'supplier-b', supplierName: 'B Foods', deliveryDate: '2026-09-05',
          expectedTotalPaise: '90000', check: null,
        },
      ],
    });
  });
});
