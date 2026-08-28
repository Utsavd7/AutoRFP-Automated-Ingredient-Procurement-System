import { AuthorizationError } from '@/lib/auth/guards';
import {
  createExportOperations,
  ExportConflictError,
  ExportNotFoundError,
  parseSupplierShareUrl,
} from '@/lib/exports/export-service';
import { digestOpaqueToken } from '@/lib/security/tokens';

const rawToken = 'Q'.repeat(43);

function activeUser() {
  return { id: 'member-a' };
}

function requestRecord() {
  return {
    id: 'request-a',
    title: 'Fresh produce week 36',
    status: 'AWARDED',
    deliveryDate: new Date('2026-09-05T00:00:00.000Z'),
    quoteDeadline: new Date('2026-09-03T10:00:00.000Z'),
    deliveryDetails: {
      addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001',
    },
    commercialTerms: 'Payment in 15 days.',
    items: [{ id: 'item-a', name: '=Tomato', quantity: { toString: () => '100' }, unit: 'KILOGRAM' }],
    supplierRequests: [],
    award: null,
  };
}

function awardRecord() {
  return {
    id: 'award-a',
    requestId: 'request-a',
    rationale: 'Best landed cost.',
    supplierSnapshots: [
      {
        supplierId: 'supplier-a', supplierName: 'Snapshot Fresh Foods', contactName: 'Anita Shah',
        phone: '9111111111', whatsappNumber: null, email: 'orders@example.test',
        addressLine: '7 APMC Yard', city: 'Navi Mumbai', state: 'Maharashtra', pin: '400705',
        gstin: '27ABCDE9999F1Z1', quoteId: 'quote-a', supplierRequestId: 'grant-a', revision: 1,
        freightPaise: '50000', deliveryDate: '2026-09-05', validUntil: '2026-09-04',
        commercialTerms: 'Payment in 15 days.', notes: null, submittedAt: '2026-08-28T09:00:00.000Z',
      },
    ],
    deliverySnapshot: {
      requestTitle: 'Fresh produce week 36',
      requestedDeliveryDate: '2026-09-05',
      deliveryDetails: {
        addressLine: 'Service gate, 18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001',
      },
      buyer: {
        name: 'Cedar Table Hospitality', gstin: '27ABCDE1234F1Z5', addressLine: '18 Market Road',
        city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000',
      },
    },
    totalPaise: BigInt(8_416_400),
    createdAt: new Date('2026-08-28T10:00:00.000Z'),
    tenant: {
      name: 'Cedar Table Hospitality', gstin: '27ABCDE1234F1Z5', addressLine: '18 Market Road',
      city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000',
    },
    request: { title: 'Edited live request title' },
    lines: [
      {
        requestItemId: 'item-a', supplierId: 'supplier-a', quantity: { toString: () => '100' },
        unit: 'KILOGRAM', unitRatePaise: BigInt(79_680), gstBasisPoints: 500,
        subtotalPaise: BigInt(7_968_000), gstPaise: BigInt(398_400), totalPaise: BigInt(8_366_400),
        requestItem: { name: 'Tomato' },
      },
    ],
  };
}

function fakeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    user: { findFirst: jest.fn().mockResolvedValue(activeUser()) },
    procurementRequest: { findFirst: jest.fn().mockResolvedValue(requestRecord()) },
    supplierRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    award: { findFirst: jest.fn().mockResolvedValue(awardRecord()) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-a' }) },
    ...overrides,
  };
}

function serviceFor(transaction: ReturnType<typeof fakeTransaction>) {
  return createExportOperations({
    transact: async (_tenantId, callback) => callback(transaction as never),
    renderQr: jest.fn(async () => new Uint8Array(Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1'))),
    renderPdf: jest.fn(async () => new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2_000)]))),
  });
}

describe('on-demand export service', () => {
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
      `https://quoteplate.example/quote#token=${rawToken}&next=https://attacker.example`,
      `https://quoteplate.example/product#token=${rawToken}`,
    ]) {
      expect(() => parseSupplierShareUrl(invalid, 'https://quoteplate.example')).toThrow(
        ExportNotFoundError,
      );
    }
  });

  it('exports a tenant-owned request for an active member with formula-safe CSV and bounded audit metadata', async () => {
    const transaction = fakeTransaction();
    const service = serviceFor(transaction);

    const output = await service.requestCsv({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      kind: 'request',
    });

    expect(output.mediaType).toBe('text/csv; charset=utf-8');
    expect(output.filename).toBe('fresh-produce-week-36-request.csv');
    expect(Buffer.from(output.bytes).toString()).toContain("'=Tomato");
    expect(transaction.procurementRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a', id: 'request-a' } }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a', actorUserId: 'member-a', action: 'audit.export',
        entityType: 'ProcurementRequest', entityId: 'request-a',
        metadata: expect.objectContaining({ kind: 'request', format: 'csv' }),
      }),
    });
    expect(transaction).not.toHaveProperty('generatedFile');
  });

  it('denies inactive users and hides cross-tenant requests as not found', async () => {
    const inactive = fakeTransaction({ user: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(serviceFor(inactive).requestCsv({
      actor: { tenantId: 'tenant-a', userId: 'member-a' }, requestId: 'request-a', kind: 'request',
    })).rejects.toBeInstanceOf(AuthorizationError);

    const missing = fakeTransaction({
      procurementRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(serviceFor(missing).requestCsv({
      actor: { tenantId: 'tenant-b', userId: 'member-b' }, requestId: 'request-a', kind: 'request',
    })).rejects.toBeInstanceOf(ExportNotFoundError);
  });

  it('creates a QR only when the raw URL digest belongs to the tenant request', async () => {
    const transaction = fakeTransaction({
      supplierRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'grant-a', supplier: { businessName: 'Snapshot Fresh Foods' }, request: { title: 'Fresh produce' },
        }),
      },
    });
    let transactionDepth = 0;
    const transact = jest.fn(async (_tenantId, callback: (value: never) => Promise<unknown>) => {
      transactionDepth += 1;
      try {
        return await callback(transaction as never);
      } finally {
        transactionDepth -= 1;
      }
    });
    const renderQr = jest.fn(async () => {
      expect(transactionDepth).toBe(0);
      return new Uint8Array(Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1'));
    });
    const service = createExportOperations({
      transact: transact as never,
      renderQr,
      renderPdf: jest.fn(),
    });
    const url = `https://quoteplate.example/quote#token=${rawToken}`;

    const output = await service.qr({
      actor: { tenantId: 'tenant-a', userId: 'member-a' }, requestId: 'request-a',
      expectedOrigin: 'https://quoteplate.example', url,
    });

    expect(output.mediaType).toBe('image/png');
    expect(transact).toHaveBeenCalledTimes(2);
    expect(service.dependencies.renderQr).toHaveBeenCalledWith(url);
    expect(transaction.supplierRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-a', requestId: 'request-a',
          tokenDigest: digestOpaqueToken('supplier-request', rawToken), revokedAt: null,
        }),
      }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { kind: 'supplier-link', format: 'png', byteCount: 8 } }),
    });
    expect(JSON.stringify(transaction.auditEvent.create.mock.calls)).not.toContain(rawToken);
  });

  it('builds one supplier PO entirely from the committed snapshot and split lines', async () => {
    const transaction = fakeTransaction({
      award: {
        findFirst: jest.fn().mockResolvedValue({
          ...awardRecord(),
          tenant: {
            name: 'Edited live restaurant', gstin: null, addressLine: 'Edited address',
            city: 'Pune', state: 'Maharashtra', pin: '411001', phone: '9888888888',
          },
        }),
      },
    });
    const service = serviceFor(transaction);
    const output = await service.purchaseOrder({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      awardId: 'award-a', supplierId: 'supplier-a',
    });

    expect(output.mediaType).toBe('application/pdf');
    expect(output.filename).toBe('fresh-produce-week-36-po-snapshot-fresh-foods.pdf');
    expect(Buffer.from(output.bytes).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const renderPdf = service.dependencies.renderPdf as jest.Mock;
    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({
      requestTitle: 'Fresh produce week 36',
      buyer: {
        name: 'Cedar Table Hospitality', gstin: '27ABCDE1234F1Z5', addressLine: '18 Market Road',
        city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000',
      },
      supplier: expect.objectContaining({ supplierName: 'Snapshot Fresh Foods' }),
      lines: [expect.objectContaining({ itemName: 'Tomato' })],
      totalPaise: '8416400',
    }));
    expect(transaction).not.toHaveProperty('supplier');
  });

  it('uses the award-time request title in award and accounting records', async () => {
    const transaction = fakeTransaction({
      procurementRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...requestRecord(),
          title: 'Edited live request title',
          award: awardRecord(),
        }),
      },
    });
    const service = serviceFor(transaction);

    for (const kind of ['award', 'accounting'] as const) {
      const output = await service.requestCsv({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
        requestId: 'request-a',
        kind,
      });
      expect(Buffer.from(output.bytes).toString()).toContain('Fresh produce week 36');
      expect(Buffer.from(output.bytes).toString()).not.toContain('Edited live request title');
      expect(output.filename).toBe(`fresh-produce-week-36-${kind}.csv`);
    }
  });

  it('rejects award and accounting exports before a committed award exists', async () => {
    const transaction = fakeTransaction();
    const service = serviceFor(transaction);
    await expect(service.requestCsv({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a', kind: 'award',
    })).rejects.toBeInstanceOf(ExportConflictError);
  });

  it('rejects renderer output that is not actually PNG or PDF data', async () => {
    const transaction = fakeTransaction({
      supplierRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'grant-a', supplier: { businessName: 'Fresh Foods' }, request: { title: 'Fresh produce' },
        }),
      },
    });
    const service = createExportOperations({
      transact: async (_tenantId, callback) => callback(transaction as never),
      renderQr: async () => new TextEncoder().encode('not a PNG'),
      renderPdf: async () => new TextEncoder().encode('not a PDF'),
    });
    await expect(service.qr({
      actor: { tenantId: 'tenant-a', userId: 'member-a' }, requestId: 'request-a',
      expectedOrigin: 'https://quoteplate.example',
      url: `https://quoteplate.example/quote#token=${rawToken}`,
    })).rejects.toThrow('valid PNG');
    await expect(service.purchaseOrder({
      actor: { tenantId: 'tenant-a', userId: 'member-a' }, awardId: 'award-a', supplierId: 'supplier-a',
    })).rejects.toThrow('valid PDF');
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});
