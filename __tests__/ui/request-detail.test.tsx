import { renderToStaticMarkup } from 'react-dom/server';

import {
  RequestDetail,
  SupplierFreshLinkActions,
} from '@/components/procurement/RequestDetail';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('procurement request detail', () => {
  it('shows request facts, supplier progress, and deterministic quote comparison', () => {
    const html = renderToStaticMarkup(
      <RequestDetail
        requestId="request-1"
        initialRequest={{
          id: 'request-1', title: 'Fresh produce · Week 36', status: 'OPEN', version: 2,
          deliveryDetails: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
          deliveryDate: '2026-09-05T00:00:00.000Z', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: 'Payment in 15 days',
          items: [{ id: 'item-1', name: 'Tomato', quantity: '100', unit: 'KILOGRAM' }],
          supplierRequests: [{ id: 'grant-1', supplierId: 'supplier-1', expiresAt: '2026-09-03T10:00:00.000Z', revokedAt: null, viewedAt: '2026-08-28T09:00:00.000Z', supplier: { id: 'supplier-1', businessName: 'GreenLeaf Fresh Foods', contactName: 'Meera Shah', phone: '+919876543210', whatsappNumber: '+919876543210', email: null, isActive: true } }],
        }}
        initialComparison={{
          request: { id: 'request-1', title: 'Fresh produce · Week 36', deliveryDate: '2026-09-05', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: 'Payment in 15 days', itemCount: 1, items: [{ id: 'item-1', name: 'Tomato', quantity: '100', unit: 'KILOGRAM' }] },
          quotes: [{ supplierRequestId: 'grant-1', supplierName: 'GreenLeaf Fresh Foods', supplierActive: true, revision: 1, subtotalPaise: '7968000', gstPaise: '398400', freightPaise: '0', totalPaise: '8366400', deliveryDate: '2026-09-05', validUntil: '2026-09-04', submittedAt: '2026-08-28T09:30:00.000Z', minimumOrder: null, commercialTerms: '15 days', notes: null, coveredItemCount: 1, totalItemCount: 1, fullCoverage: true, deliveryFit: 'ON_OR_BEFORE', expired: false, missingTerms: false, missingRequestItemIds: [], partialRequestItemIds: [], unitMismatchRequestItemIds: [], substitutions: [], items: [{ requestItemId: 'item-1', requestItemKey: 'tomato', requestItemName: 'Tomato', requestedQuantity: '100', requestUnit: 'KILOGRAM', requestedSpecification: { v: 1, category: 'VEGETABLES', description: null, preferredBrand: null, packSize: null, qualityGrade: null, notes: null, referenceUrl: null, thumbnailWebpBase64: null }, suppliedSpecification: { brand: null, packSize: null, qualityGrade: null }, quotedAvailableQuantity: '100', quotedUnit: 'KILOGRAM', normalizedAvailableQuantity: '100', normalizedUnitRatePaise: '79680', unitComparable: true, coverage: 'FULL', gstBasisPoints: 500, taxInclusive: false, substitution: null, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }] }],
        }}
      />,
    );

    expect(html).toContain('Fresh produce · Week 36');
    expect(html).toContain('Tomato');
    expect(html).toContain('GreenLeaf Fresh Foods');
    expect(html).toContain('₹83,664.00');
    expect(html).toContain('Viewed');
    expect(html).toContain('Whole request');
    expect(html).toContain('Split by item');
    expect(html).toContain('full landed total');
    expect(html).toContain('Refresh quotes');
    expect(html).toContain('Record award');
    expect(html).toContain('Download records');
    expect(html).toContain('Request CSV');
    expect(html).toContain('Quote comparison CSV');
    expect(html).not.toContain('Award decision CSV');
    expect(html).not.toContain('recommended winner');
  });

  it('lets a draft be edited before private links are created', () => {
    const html = renderToStaticMarkup(
      <RequestDetail
        requestId="request-draft"
        initialRequest={{
          id: 'request-draft', title: 'Dairy · Monday', status: 'DRAFT', version: 1,
          deliveryDetails: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
          deliveryDate: '2026-09-05T00:00:00.000Z', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: null,
          items: [{ id: 'milk', name: 'Milk', quantity: '40', unit: 'LITRE' }],
          supplierRequests: [{ id: 'grant-draft', supplierId: 'supplier-1', expiresAt: '2026-09-03T10:00:00.000Z', revokedAt: null, viewedAt: null, supplier: { id: 'supplier-1', businessName: 'Shakti Dairy', contactName: null, phone: '+919876543210', whatsappNumber: null, email: null, isActive: true } }],
        }}
      />,
    );
    expect(html).toContain('Edit draft');
    expect(html).toContain('Open and create links');
    expect(html).not.toContain('Private quote link for Shakti Dairy');
  });

  it('renders the complete immutable decision record after refresh', () => {
    const request = {
      id: 'request-1', title: 'Fresh produce · Week 36', status: 'AWARDED' as const, version: 3,
      deliveryDetails: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
      deliveryDate: '2026-09-05T00:00:00.000Z', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: 'Payment in 15 days',
      items: [{ id: 'item-1', name: 'Tomato', quantity: '100', unit: 'KILOGRAM' }],
      supplierRequests: [{ id: 'grant-1', supplierId: 'supplier-1', expiresAt: '2026-09-03T10:00:00.000Z', revokedAt: null, viewedAt: '2026-08-28T09:00:00.000Z', supplier: { id: 'supplier-1', businessName: 'Renamed Supplier', contactName: null, phone: null, whatsappNumber: null, email: null, isActive: true } }],
    };
    const html = renderToStaticMarkup(
      <RequestDetail
        requestId="request-1"
        initialRequest={request}
        initialComparison={{
          request: {
            id: request.id, title: request.title, deliveryDate: '2026-09-05', quoteDeadline: request.quoteDeadline,
            commercialTerms: request.commercialTerms, itemCount: 1, items: request.items,
            status: 'AWARDED', version: 3,
            award: {
              id: 'award-1', requestId: request.id, rationale: 'Best complete landed price and on-time delivery.',
              totalPaise: '8366400', createdAt: '2026-08-28T10:00:00.000Z', splitAward: false,
              suppliers: [{ supplierId: 'supplier-1', supplierRequestId: 'grant-1', quoteRevision: 2, supplierName: 'GreenLeaf Fresh Foods', freightPaise: '0', deliveryDate: '2026-09-05', gstin: '27ABCDE1234F1Z5', commercialTerms: '15 days', lines: [{ requestItemId: 'item-1', itemName: 'Tomato' }] }],
              lines: [{ requestItemId: 'item-1', supplierRequestId: 'grant-1', supplierId: 'supplier-1', quoteRevision: 2, quantity: '100', unit: 'KILOGRAM', unitRatePaise: '79680', gstBasisPoints: 500, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }],
            },
          },
          quotes: [{ supplierRequestId: 'grant-1', supplierName: 'GreenLeaf Fresh Foods', supplierActive: true, revision: 2, subtotalPaise: '7968000', gstPaise: '398400', freightPaise: '0', totalPaise: '8366400', deliveryDate: '2026-09-05', validUntil: '2026-09-04', submittedAt: '2026-08-28T09:30:00.000Z', minimumOrder: null, commercialTerms: '15 days', notes: null, coveredItemCount: 1, totalItemCount: 1, fullCoverage: true, deliveryFit: 'ON_OR_BEFORE', expired: false, missingTerms: false, missingRequestItemIds: [], partialRequestItemIds: [], unitMismatchRequestItemIds: [], substitutions: [], items: [{ requestItemId: 'item-1', requestItemKey: 'tomato', requestItemName: 'Tomato', requestedQuantity: '100', requestUnit: 'KILOGRAM', requestedSpecification: { v: 1, category: 'VEGETABLES', description: null, preferredBrand: null, packSize: null, qualityGrade: null, notes: null, referenceUrl: null, thumbnailWebpBase64: null }, suppliedSpecification: { brand: null, packSize: null, qualityGrade: null }, quotedAvailableQuantity: '100', quotedUnit: 'KILOGRAM', normalizedAvailableQuantity: '100', normalizedUnitRatePaise: '79680', unitComparable: true, coverage: 'FULL', gstBasisPoints: 500, taxInclusive: false, substitution: null, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }] }],
        }}
      />,
    );
    expect(html).toContain('Final decision record');
    expect(html).toContain('Best complete landed price and on-time delivery.');
    expect(html).toContain('GreenLeaf Fresh Foods');
    expect(html).toContain('₹83,664.00');
    expect(html).toContain('This record uses the supplier, quote, quantity, tax and delivery facts saved at the time of the award.');
    expect(html).toContain('Award decision CSV');
    expect(html).toContain('Accounting CSV');
    expect(html).toContain('Purchase order · GreenLeaf Fresh Foods');
  });

  it('offers an accessible QR download only while a fresh supplier link is visible', () => {
    const html = renderToStaticMarkup(
      <SupplierFreshLinkActions
        link={{
          supplierRequestId: 'grant-1', supplierId: 'supplier-1',
          businessName: 'GreenLeaf Fresh Foods',
          url: `https://quoteplate.example/quote#token=${'Q'.repeat(43)}`,
          expiresAt: '2026-09-03T10:00:00.000Z',
        }}
        busy={false}
        onCopy={jest.fn()}
        onWhatsApp={jest.fn()}
        onQr={jest.fn()}
      />,
    );

    expect(html).toContain('Copy');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('Download QR for GreenLeaf Fresh Foods');
  });
});
