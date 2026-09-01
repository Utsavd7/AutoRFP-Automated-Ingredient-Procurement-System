import { buildHistoryGuidance } from '@/lib/reporting/history-guidance';

const specification = { v: 1 as const, category: 'VEGETABLES' as const };

function award(input: {
  id: string;
  createdAt: string;
  requestedQuantity: string;
  unit?: 'KILOGRAM' | 'PACK';
  splits?: Array<{ supplierId: string; supplierName: string; quantity: string }>;
}) {
  const unit = input.unit ?? 'KILOGRAM';
  const splits = input.splits ?? [{
    supplierId: `supplier-${input.id}`,
    supplierName: `Supplier ${input.id}`,
    quantity: input.requestedQuantity,
  }];
  return {
    id: input.id,
    createdAt: new Date(input.createdAt),
    allocationLines: {
      v: 1 as const,
      lines: splits.map((split, index) => ({
        requestItemId: 'historical-line', supplierRequestId: `grant-${input.id}-${index}`,
        supplierId: split.supplierId, quoteRevision: 1, quantity: split.quantity,
        unit, unitRatePaise: '1000', gstBasisPoints: 0,
        subtotalPaise: '1000', gstPaise: '0', totalPaise: '1000',
      })),
    },
    supplierSnapshots: {
      v: 1 as const,
      suppliers: splits.map((split, index) => ({
        supplierId: split.supplierId, supplierRequestId: `grant-${input.id}-${index}`,
        quoteRevision: 1, supplierName: split.supplierName,
        lines: [{
          requestItemId: 'historical-line', itemKey: 'mango', itemName: 'Mango',
          requestedQuantity: input.requestedQuantity, requestedUnit: unit,
          requestedSpecification: specification,
        }],
      })),
    },
  };
}

describe('history guidance', () => {
  it('keeps exact quantities and every supplier from the latest split award', () => {
    const result = buildHistoryGuidance({
      items: [{ itemKey: 'mango', itemName: 'Mango', quantity: '12.5', unit: 'KILOGRAM' }],
      awards: [award({
        id: 'latest', createdAt: '2026-08-20T10:00:00.000Z', requestedQuantity: '12.5',
        splits: [
          { supplierId: 'supplier-b', supplierName: 'Beta Foods', quantity: '7.25' },
          { supplierId: 'supplier-a', supplierName: 'Alpha Foods', quantity: '5.25' },
        ],
      })],
    });

    expect(result).toEqual([{
      itemKey: 'mango', itemName: 'Mango', unit: 'KILOGRAM',
      lastOrderedQuantity: '12.5', lastOrderedAt: '2026-08-20T10:00:00.000Z',
      lastSupplierNames: ['Alpha Foods', 'Beta Foods'],
      seasonalNotice: expect.stringMatching(/^Seasonality check:/),
      unusualQuantityNotice: null,
    }]);
  });

  it('flags only materially unusual quantities with four same-unit samples', () => {
    const awards = ['10', '12', '15', '20'].map((requestedQuantity, index) => award({
      id: String(index),
      createdAt: `2026-0${index + 1}-01T00:00:00.000Z`,
      requestedQuantity,
    }));
    const high = buildHistoryGuidance({
      items: [{ itemKey: 'mango', itemName: 'Mango', quantity: '40.001', unit: 'KILOGRAM' }],
      awards,
    });
    const boundary = buildHistoryGuidance({
      items: [{ itemKey: 'mango', itemName: 'Mango', quantity: '40', unit: 'KILOGRAM' }],
      awards,
    });

    expect(high[0]?.unusualQuantityNotice).toBe(
      'Quantity check: this is more than twice the largest of 4 same-unit prior awards.',
    );
    expect(boundary[0]?.unusualQuantityNotice).toBeNull();
  });

  it('never compares pack, case, or crate history across units and caps history at 50 awards', () => {
    const awards = Array.from({ length: 55 }, (_, index) => award({
      id: String(index).padStart(2, '0'),
      createdAt: new Date(Date.UTC(2026, 7, 31 - (index % 28), 0, 0, index)).toISOString(),
      requestedQuantity: '1',
      unit: index < 3 ? 'PACK' : 'KILOGRAM',
    }));
    const result = buildHistoryGuidance({
      items: [{ itemKey: 'mango', itemName: 'Mango', quantity: '100', unit: 'PACK' }],
      awards,
    });

    expect(result[0]?.unusualQuantityNotice).toBeNull();
    expect(result[0]?.lastOrderedQuantity).toBe('1');
  });

  it('uses only reviewed stable produce keys for cautious seasonal checks', () => {
    const result = buildHistoryGuidance({
      items: [
        { itemKey: 'mango', itemName: 'Mango', quantity: '1', unit: 'KILOGRAM' },
        { itemKey: 'custom-produce', itemName: 'Custom produce', quantity: '1', unit: 'KILOGRAM' },
      ],
      awards: [],
    });

    expect(result[0]?.seasonalNotice).toBe(
      'Seasonality check: Mango has a March–July India review window; confirm current availability with suppliers.',
    );
    expect(result[1]?.seasonalNotice).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/winner|best|recommended|savings/i);
  });
});
