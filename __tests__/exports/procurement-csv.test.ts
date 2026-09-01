import {
  accountingCsv,
  awardCsv,
  quoteComparisonCsv,
  requestCsv,
  type AwardExport,
} from '@/lib/exports/procurement-csv';

const specification = {
  v: 1 as const,
  category: 'VEGETABLES' as const,
  description: 'Firm red tomato',
  preferredBrand: 'Farm Select',
  packSize: '5 kg crate',
  qualityGrade: 'A',
  notes: null,
  referenceUrl: null,
  thumbnailWebpBase64: null,
};

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
    instructions: null,
  },
  commercialTerms: 'Payment in 15 days',
  items: [
    {
      id: 'item-1',
      itemKey: 'tomato',
      name: '=IMPORTXML(1)',
      quantity: '100',
      unit: 'KILOGRAM' as const,
      specification,
    },
  ],
};

const award: AwardExport = {
  id: 'award-1',
  requestId: 'request-1',
  requestTitle: 'Fresh produce · Week 36',
  rationale: 'Selected for confirmed delivery and complete stock.',
  totalPaise: '8416400',
  createdAt: '2026-08-28T10:00:00.000Z',
  suppliers: [{
    supplierId: 'supplier-1',
    supplierName: '+GreenLeaf',
    gstin: '27ABCDE1234F1Z5',
    freightPaise: '50000',
  }],
  lines: [{
    requestItemId: 'item-1',
    itemKey: 'tomato',
    itemName: 'Tomato',
    requestedQuantity: '100',
    requestedUnit: 'KILOGRAM',
    requestedSpecification: specification,
    supplierId: 'supplier-1',
    quantity: '100',
    unit: 'KILOGRAM',
    unitRatePaise: '79680',
    gstBasisPoints: 500,
    taxInclusive: false,
    suppliedBrand: 'Market Fresh',
    suppliedPackSize: '10 kg crate',
    suppliedQualityGrade: 'Premium',
    substitution: 'Roma tomato',
    subtotalPaise: '7968000',
    gstPaise: '398400',
    totalPaise: '8366400',
  }],
};

describe('compact procurement CSV exports', () => {
  it('exports request document facts and neutralizes formula values', () => {
    const csv = requestCsv(request);
    expect(csv).toContain('"Request ID","Request title","Status"');
    expect(csv).toContain("'=IMPORTXML(1)");
    expect(csv).toContain('"Farm Select","5 kg crate","A"');
  });

  it('exports each current embedded quote line with factual specifications and landed totals', () => {
    const csv = quoteComparisonCsv({
      request: { ...request, itemCount: 1 },
      quotes: [{
        supplierRequestId: 'supplier-request-1',
        supplierName: 'GreenLeaf Fresh Foods',
        supplierActive: false,
        revision: 2,
        submittedAt: '2026-08-28T09:30:00.000Z',
        deliveryDate: '2026-09-05',
        validUntil: '2026-09-04',
        minimumOrder: 'Minimum invoice INR 2,500',
        subtotalPaise: '7968000',
        gstPaise: '398400',
        freightPaise: '0',
        totalPaise: '8366400',
        coveredItemCount: 1,
        totalItemCount: 1,
        commercialTerms: '15 days',
        notes: null,
        deliveryFit: 'ON_OR_BEFORE' as const,
        expired: false,
        missingTerms: false,
        fullCoverage: true,
        items: [{
          requestItemId: 'item-1',
          requestItemKey: 'tomato',
          requestItemName: 'Tomato',
          requestedQuantity: '100',
          requestUnit: 'KILOGRAM',
          requestedSpecification: specification,
          suppliedSpecification: {
            brand: 'Market Fresh',
            packSize: '10 kg crate',
            qualityGrade: 'Premium',
          },
          quotedAvailableQuantity: '100',
          quotedUnit: 'KILOGRAM',
          normalizedUnitRatePaise: '79680',
          gstBasisPoints: 500,
          taxInclusive: false,
          coverage: 'FULL',
          substitution: 'Roma tomato',
          subtotalPaise: '7968000',
          gstPaise: '398400',
          totalPaise: '8366400',
        }],
      }],
    });
    expect(csv).toContain('"GreenLeaf Fresh Foods","supplier-request-1","2"');
    expect(csv).toContain('"Farm Select","Market Fresh","5 kg crate","10 kg crate"');
    expect(csv).toContain('"796.80","5","No"');
    expect(csv).toContain('"Minimum invoice INR 2,500"');
    expect(csv).not.toMatch(/winner|cheapest|savings/i);
  });

  it('exports committed allocations with requested-versus-supplied facts and formula safety', () => {
    const csv = awardCsv(award);
    expect(csv).toContain("'+GreenLeaf");
    expect(csv).toContain('"Farm Select","Market Fresh","5 kg crate","10 kg crate"');
    expect(csv).toContain('"A","Premium","Roma tomato"');
    expect(csv).toContain('"Selected for confirmed delivery and complete stock."');
  });

  it('exports supplier-level accounting totals from committed documents', () => {
    const csv = accountingCsv(award);
    expect(csv).toContain("\"'+GreenLeaf\"");
    expect(csv).toContain('"79680.00","3984.00","83664.00","500.00","84164.00"');
    expect(csv).toContain('"award-1","request-1"');
  });
});
