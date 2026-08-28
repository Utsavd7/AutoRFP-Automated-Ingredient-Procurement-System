import {
  accountingCsv,
  awardCsv,
  quoteComparisonCsv,
  requestCsv,
} from '@/lib/exports/procurement-csv';

const request = {
  id: 'request-1',
  title: 'Fresh produce · Week 36',
  status: 'OPEN',
  deliveryDate: '2026-09-05',
  quoteDeadline: '2026-09-03T10:00:00.000Z',
  deliveryDetails: {
    addressLine: '18 Market Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    pin: '400001',
  },
  commercialTerms: 'Payment in 15 days',
  items: [
    { id: 'item-1', name: '=IMPORTXML(1)', quantity: '100', unit: 'KILOGRAM' },
  ],
};

describe('procurement CSV exports', () => {
  it('exports request facts and neutralizes formula values', () => {
    const csv = requestCsv(request);
    expect(csv).toContain('"Request ID","Request title","Status"');
    expect(csv).toContain("'=IMPORTXML(1)");
    expect(csv).toContain('"100","KILOGRAM"');
  });

  it('exports each latest quote item with landed totals', () => {
    const csv = quoteComparisonCsv({
      request: { ...request, itemCount: 1 },
      quotes: [
        {
          quoteId: 'quote-1', supplierName: 'GreenLeaf Fresh Foods', revision: 2,
          submittedAt: '2026-08-28T09:30:00.000Z', deliveryDate: '2026-09-05', validUntil: '2026-09-04',
          subtotalPaise: '7968000', gstPaise: '398400', freightPaise: '0', totalPaise: '8366400',
          coveredItemCount: 1, totalItemCount: 1, commercialTerms: '15 days', notes: null,
          supplierActive: false, awardable: false, awardIssues: ['SUPPLIER_INACTIVE'],
          deliveryFit: 'ON_OR_BEFORE', expired: false, missingTerms: false, fullCoverage: true,
          items: [{ requestItemId: 'item-1', requestItemName: 'Tomato', quoteItemId: 'quote-item-1', requestedQuantity: '100', requestUnit: 'KILOGRAM', quotedAvailableQuantity: '100', quotedUnit: 'KILOGRAM', normalizedUnitRatePaise: '79680', gstBasisPoints: 500, taxInclusive: false, coverage: 'FULL', substitution: null, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }],
        },
      ],
    });
    expect(csv).toContain('"GreenLeaf Fresh Foods","2"');
    expect(csv).toContain('"796.80","5","No"');
    expect(csv).toContain('"83664.00"');
    expect(csv).toContain('"No","No","SUPPLIER_INACTIVE","On or before requested date"');
  });

  it('exports committed award lines and snapshots', () => {
    const csv = awardCsv({
      id: 'award-1', requestId: 'request-1', requestTitle: 'Fresh produce · Week 36',
      rationale: 'Best full delivery', totalPaise: '8366400', createdAt: '2026-08-28T10:00:00.000Z',
      suppliers: [{ supplierId: 'supplier-1', supplierName: 'GreenLeaf Fresh Foods', gstin: '27ABCDE1234F1Z5', freightPaise: '0' }],
      lines: [{ requestItemId: 'item-1', itemName: 'Tomato', supplierId: 'supplier-1', quantity: '100', unit: 'KILOGRAM', unitRatePaise: '79680', gstBasisPoints: 500, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }],
    });
    expect(csv).toContain('"GreenLeaf Fresh Foods","27ABCDE1234F1Z5"');
    expect(csv).toContain('"Tomato","100","KILOGRAM","796.80"');
    expect(csv).toContain('"Best full delivery"');
  });

  it('exports supplier-level accounting totals from the committed award', () => {
    const csv = accountingCsv({
      id: 'award-1', requestId: 'request-1', requestTitle: 'Fresh produce · Week 36',
      rationale: 'Best full delivery', totalPaise: '8416400', createdAt: '2026-08-28T10:00:00.000Z',
      suppliers: [
        { supplierId: 'supplier-1', supplierName: '+GreenLeaf', gstin: '27ABCDE1234F1Z5', freightPaise: '50000' },
      ],
      lines: [
        { requestItemId: 'item-1', itemName: 'Tomato', supplierId: 'supplier-1', quantity: '100', unit: 'KILOGRAM', unitRatePaise: '79680', gstBasisPoints: 500, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' },
      ],
    });

    expect(csv).toContain("\"'+GreenLeaf\"");
    expect(csv).toContain('"79680.00","3984.00","83664.00","500.00","84164.00"');
    expect(csv).toContain('"award-1","request-1"');
  });
});
