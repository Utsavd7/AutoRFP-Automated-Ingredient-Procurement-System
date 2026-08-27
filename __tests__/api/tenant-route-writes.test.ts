import { POST as sendRfp } from '@/app/api/send-rfp/route';
import { POST as simulateConversation } from '@/app/api/simulate-conversation/route';
import { POST as receiveInboundEmail } from '@/app/api/webhooks/inbound-email/route';
import { requireApiTenant } from '@/lib/api/require-api-tenant';
import { getEmbedding } from '@/lib/embeddings';
import { callGroqThenOllama, parseJSON } from '@/lib/llm';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/api/require-api-tenant', () => ({
  requireApiTenant: jest.fn(),
}));

jest.mock('@/lib/embeddings', () => ({
  getEmbedding: jest.fn(),
}));

jest.mock('@/lib/chroma', () => ({
  ingestQuote: jest.fn(),
}));

jest.mock('@/lib/llm', () => ({
  callGroqThenOllama: jest.fn(),
  parseJSON: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    menu: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    distributor: { findMany: jest.fn() },
    rFP: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    quote: { create: jest.fn() },
  },
}));

type JsonRequest = Request & { json: jest.Mock };

const requestWith = (body: Record<string, unknown>) =>
  ({ json: jest.fn().mockResolvedValue(body) }) as unknown as JsonRequest;

const authenticatedTenant = {
  tenant: { id: 'tenant-session' },
  response: null,
} as never;

const rfp = {
  id: 'rfp-owned',
  status: 'SENT',
  distributor: {
    id: 'distributor-1',
    name: 'Mumbai Foods',
    location: 'Mumbai',
    email: 'supplier@example.com',
  },
};

const completeQuote = {
  price: 1250,
  deliveryTerms: 'Tuesday morning',
  details: 'Full order',
  confidence: 'HIGH',
  missingInfo: [],
};

const transactionMock = prisma.$transaction as unknown as jest.Mock;
const rfpFindFirst = jest.mocked(prisma.rFP.findFirst);
const rfpUpdateMany = jest.mocked(prisma.rFP.updateMany);
const quoteCreate = jest.mocked(prisma.quote.create);
const originalLegacyFeatureFlag = process.env.AUTORFP_ENABLE_LEGACY_DEMO;

describe('tenant-owned route writes', () => {
  beforeAll(() => {
    process.env.AUTORFP_ENABLE_LEGACY_DEMO = 'true';
  });

  afterAll(() => {
    if (originalLegacyFeatureFlag === undefined) {
      delete process.env.AUTORFP_ENABLE_LEGACY_DEMO;
      return;
    }
    process.env.AUTORFP_ENABLE_LEGACY_DEMO = originalLegacyFeatureFlag;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireApiTenant).mockResolvedValue(authenticatedTenant);
    jest.mocked(getEmbedding).mockResolvedValue(null);
    transactionMock.mockImplementation(
      async (work: (transaction: typeof prisma) => Promise<unknown>) =>
        work(prisma),
    );
  });

  test.each([
    ['send-rfp', sendRfp, { distributorIds: [], menuId: 'menu-1', ingredients: [] }],
    ['simulate-conversation', simulateConversation, { rfpId: 'rfp-1' }],
    ['webhooks/inbound-email', receiveInboundEmail, { rfpId: 'rfp-1', emailBody: 'Quote' }],
  ] as const)('%s returns before parsing or external work without a session', async (_name, handler, body) => {
    jest.mocked(requireApiTenant).mockResolvedValue({
      tenant: null,
      response: new Response(null, { status: 401 }),
    } as never);
    const request = requestWith(body);

    const response = await handler(request);

    expect(response.status).toBe(401);
    expect(request.json).not.toHaveBeenCalled();
    expect(callGroqThenOllama).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(prisma.menu.findFirst).not.toHaveBeenCalled();
    expect(rfpFindFirst).not.toHaveBeenCalled();
  });

  it('does not mutate when send-rfp receives a foreign menu ID', async () => {
    jest.mocked(prisma.menu.findFirst).mockResolvedValue(null);

    const response = await sendRfp(requestWith({
      distributorIds: ['distributor-1'],
      menuId: 'menu-foreign',
      ingredients: [{ name: 'Rice', quantity: 10, unit: 'kg' }],
    }));

    expect(response.status).toBe(404);
    expect(prisma.menu.updateMany).not.toHaveBeenCalled();
    expect(prisma.rFP.create).not.toHaveBeenCalled();
  });

  test.each([
    ['simulate-conversation', simulateConversation, { rfpId: 'rfp-foreign' }],
    ['webhooks/inbound-email', receiveInboundEmail, { rfpId: 'rfp-foreign', emailBody: 'Quote' }],
  ] as const)('%s does not mutate a foreign RFP', async (_name, handler, body) => {
    rfpFindFirst.mockResolvedValue(null);

    const response = await handler(requestWith(body));

    expect(response.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(rfpUpdateMany).not.toHaveBeenCalled();
    expect(quoteCreate).not.toHaveBeenCalled();
  });

  it('reasserts menu ownership when send-rfp advances the workflow', async () => {
    jest.mocked(prisma.menu.findFirst).mockResolvedValue({ id: 'menu-owned' } as never);
    jest.mocked(prisma.distributor.findMany).mockResolvedValue([
      rfp.distributor,
    ] as never);
    jest.mocked(prisma.menu.updateMany).mockResolvedValue({ count: 1 });
    jest.mocked(prisma.rFP.create).mockResolvedValue({
      id: 'rfp-new',
      status: 'SENT',
    } as never);

    const response = await sendRfp(requestWith({
      distributorIds: ['distributor-1'],
      menuId: 'menu-owned',
      ingredients: [{ name: 'Rice', quantity: 10, unit: 'kg' }],
    }));

    expect(response.status).toBe(200);
    expect(prisma.menu.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'menu-owned', tenantId: 'tenant-session' },
      }),
    );
    expect(prisma.rFP.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-session' }),
      }),
    );
  });

  it('does not create RFPs when the tenant-scoped menu update loses ownership', async () => {
    jest.mocked(prisma.menu.findFirst).mockResolvedValue({ id: 'menu-owned' } as never);
    jest.mocked(prisma.distributor.findMany).mockResolvedValue([
      rfp.distributor,
    ] as never);
    jest.mocked(prisma.menu.updateMany).mockResolvedValue({ count: 0 });

    const response = await sendRfp(requestWith({
      distributorIds: ['distributor-1'],
      menuId: 'menu-owned',
      ingredients: [{ name: 'Rice', quantity: 10, unit: 'kg' }],
    }));

    expect(response.status).toBe(404);
    expect(prisma.rFP.create).not.toHaveBeenCalled();
  });

  it('creates a simulated quote atomically with tenant and status predicates', async () => {
    rfpFindFirst.mockResolvedValue(rfp as never);
    rfpUpdateMany.mockResolvedValue({ count: 1 });
    quoteCreate.mockResolvedValue({ id: 'quote-1', price: 1250, details: 'Full order' } as never);
    jest.mocked(callGroqThenOllama).mockResolvedValue('Vendor response');
    jest.mocked(parseJSON).mockReturnValue(completeQuote);

    const response = await simulateConversation(requestWith({
      rfpId: rfp.id,
      ingredients: [],
      pricingData: [],
    }));

    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(rfpUpdateMany).toHaveBeenCalledWith({
      where: {
        id: rfp.id,
        tenantId: 'tenant-session',
        status: 'SENT',
      },
      data: { status: 'REPLIED', repliedAt: expect.any(Date) },
    });
    expect(quoteCreate).toHaveBeenCalledTimes(1);
    expect(rfpUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      quoteCreate.mock.invocationCallOrder[0],
    );
  });

  it('uses the same atomic claim for the simulated fallback quote', async () => {
    rfpFindFirst.mockResolvedValue(rfp as never);
    rfpUpdateMany.mockResolvedValue({ count: 1 });
    quoteCreate.mockResolvedValue({ id: 'quote-fallback', price: 900, details: 'Fallback' } as never);
    jest.mocked(callGroqThenOllama).mockRejectedValue(new Error('offline'));

    const response = await simulateConversation(requestWith({
      rfpId: rfp.id,
      ingredients: [],
      pricingData: [],
    }));

    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(rfpUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: rfp.id,
          tenantId: 'tenant-session',
          status: 'SENT',
        },
      }),
    );
    expect(quoteCreate).toHaveBeenCalledTimes(1);
  });

  it('creates an inbound quote atomically with tenant and status predicates', async () => {
    rfpFindFirst.mockResolvedValue(rfp as never);
    rfpUpdateMany.mockResolvedValue({ count: 1 });
    quoteCreate.mockResolvedValue({ id: 'quote-email', price: 1250 } as never);
    jest.mocked(callGroqThenOllama).mockResolvedValue('parsed');
    jest.mocked(parseJSON).mockReturnValue(completeQuote);

    const response = await receiveInboundEmail(requestWith({
      rfpId: rfp.id,
      emailBody: 'We quote 1250 rupees.',
    }));

    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(rfpUpdateMany).toHaveBeenCalledWith({
      where: {
        id: rfp.id,
        tenantId: 'tenant-session',
        status: 'SENT',
      },
      data: { status: 'REPLIED', repliedAt: expect.any(Date) },
    });
    expect(quoteCreate).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      'simulate-conversation',
      simulateConversation,
      { rfpId: rfp.id, ingredients: [], pricingData: [] },
    ],
    [
      'webhooks/inbound-email',
      receiveInboundEmail,
      { rfpId: rfp.id, emailBody: 'We quote 1250 rupees.' },
    ],
  ] as const)('%s does not create a quote after losing the status race', async (_name, handler, body) => {
    rfpFindFirst.mockResolvedValue(rfp as never);
    rfpUpdateMany.mockResolvedValue({ count: 0 });
    jest.mocked(callGroqThenOllama).mockResolvedValue('parsed');
    jest.mocked(parseJSON).mockReturnValue(completeQuote);

    const response = await handler(requestWith(body));

    expect(response.status).toBe(409);
    expect(rfpUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: rfp.id,
          tenantId: 'tenant-session',
          status: 'SENT',
        },
      }),
    );
    expect(quoteCreate).not.toHaveBeenCalled();
  });
});
