import { digestOpaqueToken } from '@/lib/security/tokens';
import {
  PUBLIC_SUPPLIER_APPLICATION_PENDING_CAP,
  PublicSupplierApplicationUnavailableError,
  PublicSupplierApplicationValidationError,
  submitPublicSupplierApplication,
  validatePublicSupplierApplicationInput,
} from '@/lib/suppliers/public-application-service';
import {
  decideSupplierVerification,
  SupplierVerificationConflictError,
} from '@/lib/suppliers/supplier-service';

const applicationToken = 'A'.repeat(43);
const quoteToken = 'Q'.repeat(43);
const now = new Date('2027-01-08T09:00:00.000Z');
const quoteDeadline = new Date('2027-01-09T09:00:00.000Z');

const items = {
  v: 1 as const,
  items: [
    {
      id: 'item-1',
      itemKey: 'tomato',
      name: 'Tomato',
      quantity: '10',
      unit: 'KILOGRAM' as const,
      specification: { v: 1 as const, category: 'VEGETABLES' as const },
      sourcingOverride: null,
    },
  ],
};

const verifiedNewSourcing = {
  v: 1 as const,
  default: {
    v: 1 as const,
    modes: ['VERIFIED_NEW' as const],
    currentSupplierIds: [],
    selectedNewSupplierIds: [],
    acceptVerifiedApplications: true,
  },
};

const validApplication = {
  token: applicationToken,
  businessName: '  Sahyadri Fresh Foods  ',
  contactName: '  Anaya Shah  ',
  phone: '98765 43210',
  whatsappNumber: '+91 98765 43211',
  email: ' SALES@SAHYADRI.EXAMPLE ',
  categories: ['FRUITS', 'VEGETABLES'] as const,
};

const applicationWithPrototypeKey = JSON.parse(JSON.stringify(Object.fromEntries([
  ...Object.entries(validApplication),
  ['__proto__', { polluted: true }],
]))) as unknown;

const roleRow = {
  currentUser: 'autorfp_app',
  rolsuper: false,
  rolbypassrls: false,
  hasBypassMembership: false,
};

function sqlText(input: unknown) {
  if (Array.isArray(input)) return input.join('?');
  if (
    input &&
    typeof input === 'object' &&
    'strings' in input &&
    Array.isArray((input as { strings: unknown }).strings)
  ) {
    return (input as { strings: string[] }).strings.join('?');
  }
  return String(input);
}

function clientWith(transaction: Record<string, unknown>) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([roleRow]),
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(transaction),
    ),
  };
}

function liveRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-a',
    status: 'OPEN',
    items,
    sourcing: verifiedNewSourcing,
    quoteDeadline,
    applicationTokenDigest: digestOpaqueToken(
      'supplier-application',
      applicationToken,
    ),
    applicationExpiresAt: quoteDeadline,
    applicationRevokedAt: null,
    now,
    ...overrides,
  };
}

function pendingSupplier(overrides: Record<string, unknown> = {}) {
  return {
    id: 'supplier-applicant',
    relationshipType: 'APPLICANT',
    verificationStatus: 'PENDING',
    applicationRequestId: 'request-a',
    isActive: false,
    verifiedAt: null,
    verifiedByUserId: null,
    ...overrides,
  };
}

describe('public supplier application validation and creation', () => {
  it('normalizes bounded contacts and builds deterministic BACKUP capabilities', () => {
    expect(validatePublicSupplierApplicationInput(validApplication)).toEqual({
      token: applicationToken,
      businessName: 'Sahyadri Fresh Foods',
      contactName: 'Anaya Shah',
      phone: '+919876543210',
      whatsappNumber: '+919876543211',
      email: 'sales@sahyadri.example',
      categories: ['VEGETABLES', 'FRUITS'],
      capabilities: {
        v: 1,
        categories: [
          { category: 'VEGETABLES', tier: 'BACKUP', rank: 1 },
          { category: 'FRUITS', tier: 'BACKUP', rank: 2 },
        ],
        items: [],
      },
    });
  });

  it.each([
    ['non-object body', null],
    ['unknown field', { ...validApplication, tenantId: 'tenant-b' }],
    ['JSON __proto__ field', applicationWithPrototypeKey],
    ['missing contact channel', {
      token: applicationToken,
      businessName: 'No Contact Foods',
      categories: ['FRUITS'],
    }],
    ['duplicate category', {
      ...validApplication,
      categories: ['FRUITS', 'FRUITS'],
    }],
    ['unknown category', {
      ...validApplication,
      categories: ['FRUIT_AND_VEG'],
    }],
    ['empty categories', { ...validApplication, categories: [] }],
    ['invalid phone', { ...validApplication, phone: '123' }],
  ])('rejects %s without opening a transaction', async (_label, application) => {
    const client = clientWith({});

    expect(() => validatePublicSupplierApplicationInput(application)).toThrow(
      PublicSupplierApplicationValidationError,
    );
    await expect(
      submitPublicSupplierApplication(
        { application, now },
        client as never,
      ),
    ).rejects.toBeInstanceOf(PublicSupplierApplicationValidationError);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('creates only one inactive pending applicant and audits no contact data', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'supplier-applicant' });
    const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-a' });
    const transaction = {
      $queryRaw: jest.fn(async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes('set_config')) return [];
        if (sql.includes('FROM "Tenant"')) {
          return [{ id: 'tenant-a', isActive: true }];
        }
        if (sql.includes('FROM "ProcurementRequest"')) return [liveRequest()];
        throw new Error(`Unexpected query: ${sql}`);
      }),
      supplier: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create,
      },
      auditEvent: { create: auditCreate },
    };
    const exchange = jest.fn().mockResolvedValue({
      tenantId: 'tenant-a',
      requestId: 'request-a',
    });

    await expect(
      submitPublicSupplierApplication(
        { application: validApplication, now },
        clientWith(transaction) as never,
        { exchange, idFactory: () => 'supplier-applicant' },
      ),
    ).resolves.toEqual({ accepted: true });

    expect(exchange).toHaveBeenCalledWith({ token: applicationToken, now });
    expect(create).toHaveBeenCalledWith({
      data: {
        id: 'supplier-applicant',
        tenantId: 'tenant-a',
        businessName: 'Sahyadri Fresh Foods',
        contactName: 'Anaya Shah',
        phone: '+919876543210',
        whatsappNumber: '+919876543211',
        email: 'sales@sahyadri.example',
        relationshipType: 'APPLICANT',
        verificationStatus: 'PENDING',
        applicationRequestId: 'request-a',
        capabilities: {
          v: 1,
          categories: [
            { category: 'VEGETABLES', tier: 'BACKUP', rank: 1 },
            { category: 'FRUITS', tier: 'BACKUP', rank: 2 },
          ],
          items: [],
        },
        verifiedAt: null,
        verifiedByUserId: null,
        isActive: false,
      },
      select: { id: true },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-a',
        actorUserId: null,
        action: 'supplier.applied',
        entityType: 'Supplier',
        entityId: 'supplier-applicant',
        metadata: { requestId: 'request-a', categoryCount: 2 },
      },
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(
      /Sahyadri|Anaya|98765|sahyadri\.example|AAAA/,
    );
  });

  it.each([
    ['duplicate normalized contact', { duplicate: { id: 'existing' }, count: 0 }],
    [
      'request capacity',
      { duplicate: null, count: PUBLIC_SUPPLIER_APPLICATION_PENDING_CAP },
    ],
  ])('returns the identical acceptance for %s without creating a row', async (
    _label,
    state,
  ) => {
    const create = jest.fn();
    const auditCreate = jest.fn();
    const transaction = {
      $queryRaw: jest.fn(async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes('set_config')) return [];
        if (sql.includes('FROM "Tenant"')) {
          return [{ id: 'tenant-a', isActive: true }];
        }
        if (sql.includes('FROM "ProcurementRequest"')) return [liveRequest()];
        throw new Error(`Unexpected query: ${sql}`);
      }),
      supplier: {
        findFirst: jest.fn().mockResolvedValue(state.duplicate),
        count: jest.fn().mockResolvedValue(state.count),
        create,
      },
      auditEvent: { create: auditCreate },
    };

    await expect(
      submitPublicSupplierApplication(
        { application: validApplication, now },
        clientWith(transaction) as never,
        {
          exchange: jest.fn().mockResolvedValue({
            tenantId: 'tenant-a', requestId: 'request-a',
          }),
        },
      ),
    ).resolves.toEqual({ accepted: true });
    expect(create).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['closed', { status: 'CANCELLED' }],
    ['deadline passed', { quoteDeadline: now }],
    ['digest mismatched', { applicationTokenDigest: 'f'.repeat(64) }],
    ['application expired', { applicationExpiresAt: now }],
    ['application revoked', { applicationRevokedAt: now }],
    ['verified-new sourcing disabled', {
      sourcing: {
        v: 1,
        default: {
          ...verifiedNewSourcing.default,
          modes: ['CURRENT'],
          currentSupplierIds: ['supplier-current'],
          acceptVerifiedApplications: false,
        },
      },
    }],
  ])('uses one 410 error when the locked request is %s', async (
    _label,
    requestState,
  ) => {
    const transaction = {
      $queryRaw: jest.fn(async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes('set_config')) return [];
        if (sql.includes('FROM "Tenant"')) {
          return [{ id: 'tenant-a', isActive: true }];
        }
        if (sql.includes('FROM "ProcurementRequest"')) {
          return [liveRequest(requestState)];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
      supplier: {
        findFirst: jest.fn(), count: jest.fn(), create: jest.fn(),
      },
      auditEvent: { create: jest.fn() },
    };

    await expect(
      submitPublicSupplierApplication(
        { application: validApplication, now },
        clientWith(transaction) as never,
        {
          exchange: jest.fn().mockResolvedValue({
            tenantId: 'tenant-a', requestId: 'request-a',
          }),
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PublicSupplierApplicationUnavailableError>>({
        code: 'APPLICATION_UNAVAILABLE',
        status: 410,
      }),
    );
    expect(transaction.supplier.create).not.toHaveBeenCalled();
  });
});

describe('owner application approval and invitation', () => {
  function approvalTransaction(
    supplier: Record<string, unknown> = pendingSupplier(),
    request: Record<string, unknown> = liveRequest(),
  ) {
    const reviewed = {
      id: 'supplier-applicant', tenantId: 'tenant-a',
      businessName: 'Sahyadri Fresh Foods', contactName: 'Anaya Shah',
      phone: '+919876543210', whatsappNumber: null, email: null,
      addressLine: null, city: null, state: null, pin: null, gstin: null,
      notes: null, relationshipType: 'SELECTED_NEW',
      verificationStatus: 'VERIFIED', applicationRequestId: 'request-a',
      capabilities: { v: 1, categories: [], items: [] },
      verifiedAt: now, verifiedByUserId: 'owner-a', isActive: true,
      createdAt: now, updatedAt: now,
    };
    const queryRaw = jest.fn(async (query: unknown) => {
      const sql = sqlText(query);
      if (sql.includes('set_config')) return [];
      if (sql.includes('FROM "ProcurementRequest"')) return [request];
      if (sql.includes('FROM "SupplierRequest"')) return [];
      if (sql.includes('FROM "Supplier"')) return [supplier];
      throw new Error(`Unexpected query: ${sql}`);
    });
    return {
      $queryRaw: queryRaw,
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'owner-a', role: 'OWNER' }) },
      supplier: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ applicationRequestId: 'request-a' })
          .mockResolvedValueOnce(reviewed),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      supplierRequest: {
        create: jest.fn().mockResolvedValue({
          id: 'supplier-request-new', tenantId: 'tenant-a',
          requestId: 'request-a', supplierId: 'supplier-applicant',
          expiresAt: quoteDeadline, revokedAt: null, viewedAt: null,
          quoteRevision: 0, createdAt: now, updatedAt: now,
        }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-a' }) },
    };
  }

  it('locks request before supplier, verifies atomically, and returns one fragment link', async () => {
    const transaction = approvalTransaction();

    await expect(
      decideSupplierVerification(
        {
          actor: { tenantId: 'tenant-a', userId: 'owner-a' },
          supplierId: 'supplier-applicant', decision: 'APPROVE',
        },
        clientWith(transaction) as never,
        {
          tokenFactory: () => ({
            raw: quoteToken,
            digest: digestOpaqueToken('supplier-request', quoteToken),
          }),
          shareBaseUrl: 'https://quoteplate.example',
        },
      ),
    ).resolves.toEqual({
      supplier: expect.objectContaining({
        id: 'supplier-applicant', relationshipType: 'SELECTED_NEW',
        verificationStatus: 'VERIFIED', isActive: true,
      }),
      supplierRequest: expect.objectContaining({
        id: 'supplier-request-new', requestId: 'request-a',
        supplierId: 'supplier-applicant', quoteRevision: 0,
      }),
      link: {
        url: `https://quoteplate.example/quote#token=${quoteToken}`,
        expiresAt: quoteDeadline.toISOString(),
      },
    });

    const lockedTables = transaction.$queryRaw.mock.calls
      .map(([query]) => sqlText(query))
      .filter((sql) => sql.includes('FOR UPDATE'))
      .map((sql) => sql.match(/FROM "(\w+)"/)?.[1]);
    expect(lockedTables).toEqual([
      'ProcurementRequest',
      'Supplier',
      'SupplierRequest',
    ]);
    expect(transaction.supplier.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a', id: 'supplier-applicant',
        relationshipType: 'APPLICANT', verificationStatus: 'PENDING',
        isActive: false,
      },
      data: {
        relationshipType: 'SELECTED_NEW', verificationStatus: 'VERIFIED',
        applicationRequestId: 'request-a', verifiedAt: now,
        verifiedByUserId: 'owner-a', isActive: true,
      },
    });
    expect(transaction.supplierRequest.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-a', requestId: 'request-a',
        supplierId: 'supplier-applicant',
        tokenDigest: digestOpaqueToken('supplier-request', quoteToken),
        expiresAt: quoteDeadline, revokedAt: null, viewedAt: null,
        quoteRevision: 0, quoteRevisions: { v: 1, revisions: [] },
      },
      select: expect.not.objectContaining({ tokenDigest: true, quoteRevisions: true }),
    });
    expect(JSON.stringify(transaction.supplierRequest.create.mock.calls))
      .not.toContain(quoteToken);
    expect(transaction.auditEvent.create.mock.calls.map(([call]) => call.data.action))
      .toEqual(['supplier.verified', 'supplier-link.created']);
  });

  it('rejects a repeat decision without creating a second SupplierRequest', async () => {
    const transaction = approvalTransaction(pendingSupplier({
      relationshipType: 'SELECTED_NEW',
      verificationStatus: 'VERIFIED',
      isActive: true,
      verifiedAt: now,
      verifiedByUserId: 'owner-a',
    }));

    await expect(
      decideSupplierVerification(
        {
          actor: { tenantId: 'tenant-a', userId: 'owner-a' },
          supplierId: 'supplier-applicant', decision: 'APPROVE',
        },
        clientWith(transaction) as never,
        { shareBaseUrl: 'https://quoteplate.example' },
      ),
    ).rejects.toBeInstanceOf(SupplierVerificationConflictError);
    expect(transaction.supplierRequest.create).not.toHaveBeenCalled();
  });

  it('rejects without creating a SupplierRequest and records only rejection', async () => {
    const transaction = approvalTransaction();
    transaction.supplier.findFirst
      .mockReset()
      .mockResolvedValueOnce({ applicationRequestId: 'request-a' })
      .mockResolvedValueOnce({
        id: 'supplier-applicant', tenantId: 'tenant-a',
        businessName: 'Sahyadri Fresh Foods', contactName: null,
        phone: '+919876543210', whatsappNumber: null, email: null,
        addressLine: null, city: null, state: null, pin: null, gstin: null,
        notes: null, relationshipType: 'APPLICANT',
        verificationStatus: 'REJECTED', applicationRequestId: 'request-a',
        capabilities: { v: 1, categories: [], items: [] },
        verifiedAt: null, verifiedByUserId: null, isActive: false,
        createdAt: now, updatedAt: now,
      });

    await expect(
      decideSupplierVerification(
        {
          actor: { tenantId: 'tenant-a', userId: 'owner-a' },
          supplierId: 'supplier-applicant', decision: 'REJECT',
        },
        clientWith(transaction) as never,
      ),
    ).resolves.toEqual({
      supplier: expect.objectContaining({ verificationStatus: 'REJECTED' }),
    });
    expect(transaction.supplierRequest.create).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create.mock.calls.map(([call]) => call.data.action))
      .toEqual(['supplier.rejected']);
  });

  it('does not approve after request closure, expiry, or application revocation', async () => {
    for (const request of [
      liveRequest({ status: 'CANCELLED' }),
      liveRequest({ quoteDeadline: now }),
      liveRequest({ applicationExpiresAt: now }),
      liveRequest({ applicationRevokedAt: now }),
      liveRequest({ sourcing: {
        v: 1,
        default: {
          ...verifiedNewSourcing.default,
          modes: ['CURRENT'], currentSupplierIds: ['supplier-current'],
          acceptVerifiedApplications: false,
        },
      } }),
    ]) {
      const transaction = approvalTransaction(pendingSupplier(), request);
      await expect(
        decideSupplierVerification(
          {
            actor: { tenantId: 'tenant-a', userId: 'owner-a' },
            supplierId: 'supplier-applicant', decision: 'APPROVE',
          },
          clientWith(transaction) as never,
          { shareBaseUrl: 'https://quoteplate.example' },
        ),
      ).rejects.toBeInstanceOf(SupplierVerificationConflictError);
      expect(transaction.supplierRequest.create).not.toHaveBeenCalled();
    }
  });
});
