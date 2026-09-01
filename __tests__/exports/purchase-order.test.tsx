import {
  purchaseOrderDeliverySummary,
  purchaseOrderNumber,
  renderPurchaseOrderPdf,
} from '@/lib/exports/purchase-order';
import { ExportTooLargeError } from '@/lib/exports/export-service';

jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  renderToBuffer: jest.fn(async () => Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    Buffer.alloc(1_200),
  ])),
}));

const purchaseOrder = {
  awardId: 'award-12345678',
  requestId: 'request-abcdef12',
  requestTitle: 'Fresh produce · Week 36',
  awardedAt: '2026-08-28T10:00:00.000Z',
  buyer: {
    name: 'Cedar Table Hospitality',
    gstin: '27ABCDE1234F1Z5',
    addressLine: '18 Market Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    pin: '400001',
    phone: '9000000000',
  },
  delivery: {
    requestedDeliveryDate: '2026-09-05',
    addressLine: 'Service gate, 18 Market Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    pin: '400001',
    instructions: 'Deliver before 8:00 AM.',
    commercialTerms: 'Rates must include packing.',
  },
  supplier: {
    supplierId: 'supplier-87654321',
    supplierName: 'GreenLeaf Fresh Foods',
    gstin: '27ABCDE9999F1Z1',
    contactName: 'Anita Shah',
    phone: '9111111111',
    email: 'orders@greenleaf.example',
    addressLine: '7 APMC Yard',
    city: 'Navi Mumbai',
    state: 'Maharashtra',
    pin: '400705',
    freightPaise: '50000',
    minimumOrder: 'Minimum invoice INR 2,500.',
    commercialTerms: 'Payment in 15 days.',
    notes: 'Use ventilated crates.',
    deliveryDate: '2026-09-05',
    validUntil: '2026-09-04',
  },
  lines: [
    {
      requestItemId: 'item-1',
      itemName: 'Tomato',
      requestedDescription: 'Firm red tomato',
      requestedBrand: 'Farm Select',
      suppliedBrand: 'Market Fresh',
      requestedPackSize: '5 kg crate',
      suppliedPackSize: '10 kg crate',
      requestedQualityGrade: 'A',
      suppliedQualityGrade: 'Premium',
      substitution: 'Roma tomato',
      quantity: '100',
      unit: 'KILOGRAM',
      unitRatePaise: '79680',
      gstBasisPoints: 500,
      taxInclusive: false,
      subtotalPaise: '7968000',
      gstPaise: '398400',
      totalPaise: '8366400',
    },
  ],
  subtotalPaise: '7968000',
  gstPaise: '398400',
  freightPaise: '50000',
  totalPaise: '8416400',
};

describe('purchase-order PDF', () => {
  it('uses a deterministic purchase-order reference', () => {
    expect(purchaseOrderNumber(purchaseOrder)).toBe('QP-AWARD1234-SUPPLIER');
  });

  it('keeps the restaurant request date distinct from the supplier commitment', () => {
    expect(purchaseOrderDeliverySummary({
      ...purchaseOrder,
      delivery: { ...purchaseOrder.delivery, requestedDeliveryDate: '2026-09-05' },
      supplier: { ...purchaseOrder.supplier, deliveryDate: '2026-09-06' },
    })).toEqual({
      requested: 'Requested delivery: 2026-09-05',
      committed: 'Supplier committed delivery: 2026-09-06',
    });
  });

  it('renders an A4 PDF containing only the selected supplier allocation', async () => {
    const bytes = await renderPurchaseOrderPdf(purchaseOrder);

    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(bytes.byteLength).toBeLessThanOrEqual(8 * 1_024 * 1_024);
    expect(Buffer.from(bytes).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const printable = Buffer.from(bytes).toString('latin1');
    expect(printable).not.toContain('Other Supplier');
    const renderer = jest.requireMock('@react-pdf/renderer') as {
      renderToBuffer: jest.Mock;
    };
    const document = JSON.stringify(renderer.renderToBuffer.mock.calls.at(-1)?.[0]);
    expect(document).toContain('Firm red tomato');
    expect(document).toContain('Farm Select');
    expect(document).toContain('Market Fresh');
    expect(document).toContain('Roma tomato');
    expect(document).toContain('Rates must include packing.');
    expect(document).not.toContain('Award note');
    expect(document).not.toContain('Complete delivery at the best landed cost.');
  });

  it('reports an oversized rendered PDF as a bounded export error', async () => {
    const renderer = jest.requireMock('@react-pdf/renderer') as {
      renderToBuffer: jest.Mock;
    };
    renderer.renderToBuffer.mockResolvedValueOnce(Buffer.alloc(8 * 1_024 * 1_024 + 1));

    await expect(renderPurchaseOrderPdf(purchaseOrder)).rejects.toBeInstanceOf(
      ExportTooLargeError,
    );
  });
});
