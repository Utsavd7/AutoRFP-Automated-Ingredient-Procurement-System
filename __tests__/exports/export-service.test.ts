import { AuthorizationError } from '@/lib/auth/guards';
import {
  createExportOperations,
  ExportConflictError,
  ExportNotFoundError,
  parseSupplierShareUrl,
} from '@/lib/exports/export-service';
import type { PurchaseOrderData } from '@/lib/exports/purchase-order';
import { digestOpaqueToken } from '@/lib/security/tokens';

const rawToken = 'Q'.repeat(43);
const specification = {
  v: 1,
  category: 'VEGETABLES',
  description: 'Firm red tomato',
  preferredBrand: 'Farm Select',
  packSize: '5 kg crate',
  qualityGrade: 'A',
  notes: null,
  referenceUrl: null,
  thumbnailWebpBase64: null,
};
const requestItems = {
  v: 1,
  items: [{
    id: 'item-a',
    itemKey: 'tomato',
    name: '=Tomato',
    quantity: '100',
    unit: 'KILOGRAM',
    specification,
    sourcingOverride: null,
  }],
};
const requestSourcing = {
  v: 1,
  default: {
    v: 1,
    modes: ['CURRENT'],
    currentSupplierIds: ['supplier-a'],
    selectedNewSupplierIds: [],
    acceptVerifiedApplications: false,
  },
};

function requestRecord() {
  return {
    id: 'request-a',
    title: 'Edited live request title',
    status: 'AWARDED',
    deliveryDate: new Date('2026-09-05T00:00:00.000Z'),
    quoteDeadline: new Date('2026-09-03T10:00:00.000Z'),
    deliveryDetails: {
      addressLine: '18 Market Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001',
    },
    commercialTerms: 'Payment in 15 days.',
    items: requestItems,
    sourcing: requestSourcing,
    supplierRequests: [{
      id: 'supplier-request-a',
      supplierId: 'supplier-a',
      quoteRevision: 1,
      quoteRevisions: {
        v: 1,
        revisions: [{
          revision: 1,
          submittedAt: '2026-08-28T09:00:00.000Z',
          deliveryDate: '2026-09-05',
          validUntil: '2026-09-04',
          minimumOrder: 'Minimum invoice INR 2,500',
          freightPaise: '50000',
          commercialTerms: 'Payment in 15 days.',
          notes: null,
          items: [{
            requestItemId: 'item-a',
            noQuote: false,
            availableQuantity: '100',
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
          subtotalPaise: '7968000',
          gstPaise: '398400',
          totalPaise: '8416400',
        }],
      },
      supplier: {
        businessName: 'Current live supplier name',
        isActive: true,
        applicationRequestId: null,
      },
    }],
  };
}

function awardRecord() {
  return {
    id: 'award-a',
    requestId: 'request-a',
    rationale: 'Internal decision rationale must not enter the PO.',
    allocationLines: {
      v: 1,
      lines: [{
        requestItemId: 'item-a',
        supplierRequestId: 'supplier-request-a',
        supplierId: 'supplier-a',
        quoteRevision: 1,
        quantity: '100',
        unit: 'KILOGRAM',
        unitRatePaise: '79680',
        gstBasisPoints: 500,
        subtotalPaise: '7968000',
        gstPaise: '398400',
        totalPaise: '8366400',
      }],
    },
    supplierSnapshots: {
      v: 1,
      suppliers: [{
        supplierId: 'supplier-a',
        supplierRequestId: 'supplier-request-a',
        quoteRevision: 1,
        supplierName: '+Snapshot Fresh Foods',
        contactName: 'Anita Shah',
        phone: '9111111111',
        whatsappNumber: null,
        email: 'orders@example.test',
        addressLine: '7 APMC Yard',
        city: 'Navi Mumbai',
        state: 'Maharashtra',
        pin: '400705',
        gstin: '27ABCDE9999F1Z1',
        submittedAt: '2026-08-28T09:00:00.000Z',
        deliveryDate: '2026-09-05',
        validUntil: '2026-09-04',
        minimumOrder: 'Minimum invoice INR 2,500',
        freightPaise: '50000',
        commercialTerms: 'Payment in 15 days.',
        notes: null,
        subtotalPaise: '7968000',
        gstPaise: '398400',
        totalPaise: '8416400',
        lines: [{
          requestItemId: 'item-a',
          itemKey: 'tomato',
          itemName: 'Tomato',
          requestedQuantity: '100',
          requestedUnit: 'KILOGRAM',
          requestedSpecification: specification,
          taxInclusive: false,
          suppliedBrand: 'Market Fresh',
          suppliedPackSize: '10 kg crate',
          suppliedQualityGrade: 'Premium',
          substitution: 'Roma tomato',
        }],
      }],
    },
    deliverySnapshot: {
      v: 1,
      requestTitle: 'Fresh produce week 36',
      requestedDeliveryDate: '2026-09-05',
      deliveryDetails: {
        addressLine: 'Service gate, 18 Market Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400001',
        instructions: 'Deliver before 8:00 AM.',
      },
      commercialTerms: 'Rates must include packing.',
      buyer: {
        name: 'Cedar Table Hospitality',
        gstin: '27ABCDE1234F1Z5',
        addressLine: '18 Market Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400001',
        phone: '9000000000',
      },
    },
    totalPaise: BigInt(8_416_400),
    createdAt: new Date('2026-08-28T10:00:00.000Z'),
  };
}

function fakeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'member-a' }) },
    procurementRequest: {
      findFirst: jest.fn().mockResolvedValue(requestRecord()),
    },
    supplierRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    award: { findFirst: jest.fn().mockResolvedValue(awardRecord()) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-a' }) },
    ...overrides,
  };
}

function operationsFor(
  transaction: ReturnType<typeof fakeTransaction>,
  overrides: Partial<{
    renderQr: (url: string) => Promise<Uint8Array>;
    renderPdf: (data: PurchaseOrderData) => Promise<Uint8Array>;
  }> = {},
) {
  return createExportOperations({
    transact: async (_tenantId, callback) => callback(transaction as never),
    renderQr: overrides.renderQr ?? (async () =>
      new Uint8Array(Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1'))),
    renderPdf: overrides.renderPdf ?? (async () =>
      new Uint8Array(Buffer.concat([
        Buffer.from('%PDF-1.7\n'),
        Buffer.alloc(2_000),
      ]))),
  });
}

describe('compact on-demand export service', () => {
  it('parses only the canonical same-origin supplier URL and derives its digest', () => {
    expect(parseSupplierShareUrl(
      `https://quoteplate.example/quote#token=${rawToken}`,
      'https://quoteplate.example',
    )).toEqual({
      url: `https://quoteplate.example/quote#token=${rawToken}`,
      tokenDigest: digestOpaqueToken('supplier-request', rawToken),
    });
    for (const invalid of [
      `https://attacker.example/quote#token=${rawToken}`,
      `https://quoteplate.example/quote?token=${rawToken}`,
      `https://quoteplate.example/quote#token=${rawToken}&next=x`,
      `https://quoteplate.example/product#token=${rawToken}`,
    ]) {
      expect(() => parseSupplierShareUrl(
        invalid,
        'https://quoteplate.example',
      )).toThrow(ExportNotFoundError);
    }
  });

  it('exports the compact request document and current embedded quote revision', async () => {
    const transaction = fakeTransaction();
    const operations = operationsFor(transaction);

    const request = await operations.requestCsv({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      kind: 'request',
    });
    const quotes = await operations.requestCsv({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      kind: 'quotes',
    });

    expect(Buffer.from(request.bytes).toString()).toContain("'=Tomato");
    expect(Buffer.from(request.bytes).toString()).toContain('Farm Select');
    expect(Buffer.from(quotes.bytes).toString()).toContain('supplier-request-a');
    expect(Buffer.from(quotes.bytes).toString()).toContain('Market Fresh');
    expect(transaction.procurementRequest.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', id: 'request-a' },
      select: expect.objectContaining({
        items: true,
        sourcing: true,
        supplierRequests: expect.any(Object),
      }),
    });
    expect(JSON.stringify(
      transaction.procurementRequest.findFirst.mock.calls,
    )).not.toMatch(/SupplierQuote|RequestItem|quotes/);
  });

  it('prepares award/accounting CSV from Award documents only and audits output metadata', async () => {
    const transaction = fakeTransaction();
    let transactionDepth = 0;
    const transact = jest.fn(async (
      _tenantId: string,
      callback: (value: never) => Promise<unknown>,
    ) => {
      transactionDepth += 1;
      try {
        return await callback(transaction as never);
      } finally {
        transactionDepth -= 1;
      }
    });
    const operations = createExportOperations({
      transact: transact as never,
      renderQr: jest.fn(),
      renderPdf: jest.fn(),
    });

    for (const kind of ['award', 'accounting'] as const) {
      const output = await operations.requestCsv({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
        requestId: 'request-a',
        kind,
      });
      expect(transactionDepth).toBe(0);
      expect(output.filename).toBe(`fresh-produce-week-36-${kind}.csv`);
      expect(Buffer.from(output.bytes).toString()).toContain(
        'Fresh produce week 36',
      );
      expect(Buffer.from(output.bytes).toString()).not.toContain(
        'Edited live request title',
      );
    }

    expect(transaction.procurementRequest.findFirst).not.toHaveBeenCalled();
    expect(transaction.award.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', requestId: 'request-a' },
      select: {
        id: true,
        requestId: true,
        rationale: true,
        allocationLines: true,
        supplierSnapshots: true,
        deliverySnapshot: true,
        totalPaise: true,
        createdAt: true,
      },
    });
    expect(transact).toHaveBeenCalledTimes(4);
    const auditCalls = transaction.auditEvent.create.mock.calls;
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[0]![0]).toEqual({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        actorUserId: 'member-a',
        action: 'audit.export',
        entityType: 'ProcurementRequest',
        entityId: 'request-a',
        metadata: expect.objectContaining({ kind: 'award', format: 'csv' }),
      }),
    });
    expect(JSON.stringify(auditCalls)).not.toMatch(/rationale|token|Market Fresh/);
  });

  it('renders one selected-supplier PO outside transactions from Award documents only', async () => {
    const transaction = fakeTransaction();
    let depth = 0;
    const transact = jest.fn(async (
      _tenantId: string,
      callback: (value: never) => Promise<unknown>,
    ) => {
      depth += 1;
      try {
        return await callback(transaction as never);
      } finally {
        depth -= 1;
      }
    });
    const renderPdf = jest.fn(async (data: Record<string, unknown>) => {
      expect(depth).toBe(0);
      expect(data).not.toHaveProperty('rationale');
      expect(JSON.stringify(data)).not.toContain('Internal decision rationale');
      return new Uint8Array(Buffer.concat([
        Buffer.from('%PDF-1.7\n'),
        Buffer.alloc(2_000),
      ]));
    });
    const operations = createExportOperations({
      transact: transact as never,
      renderQr: jest.fn(),
      renderPdf: renderPdf as never,
    });

    const output = await operations.purchaseOrder({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      awardId: 'award-a',
      supplierId: 'supplier-a',
    });

    expect(output.filename).toBe(
      'fresh-produce-week-36-po-snapshot-fresh-foods.pdf',
    );
    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({
      requestTitle: 'Fresh produce week 36',
      buyer: expect.objectContaining({ name: 'Cedar Table Hospitality' }),
      supplier: expect.objectContaining({
        supplierName: '+Snapshot Fresh Foods',
        minimumOrder: 'Minimum invoice INR 2,500',
      }),
      lines: [expect.objectContaining({
        itemName: 'Tomato',
        requestedBrand: 'Farm Select',
        suppliedBrand: 'Market Fresh',
        requestedPackSize: '5 kg crate',
        suppliedPackSize: '10 kg crate',
        requestedQualityGrade: 'A',
        suppliedQualityGrade: 'Premium',
        substitution: 'Roma tomato',
      })],
      totalPaise: '8416400',
    }));
    expect(transaction.procurementRequest.findFirst).not.toHaveBeenCalled();
    expect(transaction.award.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', id: 'award-a' },
      select: expect.objectContaining({
        allocationLines: true,
        supplierSnapshots: true,
        deliverySnapshot: true,
      }),
    });
    expect(transact).toHaveBeenCalledTimes(2);
  });

  it('fails closed for missing/corrupt awards and inactive users', async () => {
    const missing = fakeTransaction({
      award: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(operationsFor(missing).requestCsv({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      kind: 'award',
    })).rejects.toBeInstanceOf(ExportConflictError);

    const corrupted = awardRecord();
    corrupted.totalPaise = BigInt(1);
    const corruptTransaction = fakeTransaction({
      award: { findFirst: jest.fn().mockResolvedValue(corrupted) },
    });
    await expect(operationsFor(corruptTransaction).purchaseOrder({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      awardId: 'award-a',
      supplierId: 'supplier-a',
    })).rejects.toBeInstanceOf(ExportConflictError);

    const inactive = fakeTransaction({
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(operationsFor(inactive).requestCsv({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      kind: 'request',
    })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('creates a QR outside transactions and never audits its token', async () => {
    const transaction = fakeTransaction({
      supplierRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'grant-a',
          supplier: { businessName: 'Snapshot Fresh Foods' },
          request: { title: 'Fresh produce' },
        }),
      },
    });
    let depth = 0;
    const transact = jest.fn(async (
      _tenantId: string,
      callback: (value: never) => Promise<unknown>,
    ) => {
      depth += 1;
      try {
        return await callback(transaction as never);
      } finally {
        depth -= 1;
      }
    });
    const renderQr = jest.fn(async () => {
      expect(depth).toBe(0);
      return new Uint8Array(Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1'));
    });
    const operations = createExportOperations({
      transact: transact as never,
      renderQr,
      renderPdf: jest.fn(),
    });
    const url = `https://quoteplate.example/quote#token=${rawToken}`;

    await operations.qr({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      expectedOrigin: 'https://quoteplate.example',
      url,
    });

    expect(transact).toHaveBeenCalledTimes(2);
    expect(renderQr).toHaveBeenCalledWith(url);
    expect(JSON.stringify(transaction.auditEvent.create.mock.calls))
      .not.toContain(rawToken);
  });

  it('rejects renderer output that is not actually PNG or PDF data', async () => {
    const transaction = fakeTransaction({
      supplierRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'grant-a',
          supplier: { businessName: 'Fresh Foods' },
          request: { title: 'Fresh produce' },
        }),
      },
    });
    const operations = operationsFor(transaction, {
      renderQr: async () => new TextEncoder().encode('not a PNG'),
      renderPdf: async () => new TextEncoder().encode('not a PDF'),
    });
    await expect(operations.qr({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      expectedOrigin: 'https://quoteplate.example',
      url: `https://quoteplate.example/quote#token=${rawToken}`,
    })).rejects.toThrow('valid PNG');
    await expect(operations.purchaseOrder({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      awardId: 'award-a',
      supplierId: 'supplier-a',
    })).rejects.toThrow('valid PDF');
  });
});
