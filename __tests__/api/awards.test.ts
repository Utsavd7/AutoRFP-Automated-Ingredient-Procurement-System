import { POST as createAwardRoute } from '@/app/api/requests/[id]/award/route';
import { GET as comparisonRoute } from '@/app/api/requests/[id]/comparison/route';
import {
  AwardConflictError,
  AwardNotFoundError,
  AwardSnapshotTooLargeError,
  AwardValidationError,
  createAward,
} from '@/lib/awards/award-service';
import {
  getQuoteComparison,
  QuoteComparisonNotFoundError,
} from '@/lib/comparison/compare-quotes';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({
  requireAccountContext: jest.fn(),
}));

jest.mock('@/lib/comparison/compare-quotes', () => ({
  getQuoteComparison: jest.fn(),
  QuoteComparisonNotFoundError: jest.requireActual(
    '@/lib/comparison/compare-quotes',
  ).QuoteComparisonNotFoundError,
}));

jest.mock('@/lib/awards/award-service', () => ({
  createAward: jest.fn(),
  AWARD_BODY_BYTES: jest.requireActual(
    '@/lib/awards/award-service',
  ).AWARD_BODY_BYTES,
  AwardValidationError: jest.requireActual(
    '@/lib/awards/award-service',
  ).AwardValidationError,
  AwardNotFoundError: jest.requireActual(
    '@/lib/awards/award-service',
  ).AwardNotFoundError,
  AwardConflictError: jest.requireActual(
    '@/lib/awards/award-service',
  ).AwardConflictError,
  AwardSnapshotTooLargeError: jest.requireActual(
    '@/lib/awards/award-service',
  ).AwardSnapshotTooLargeError,
}));

const account = {
  tenant: { id: 'tenant-a' },
  user: {
    id: 'owner-a',
    tenantId: 'tenant-a',
    role: 'OWNER',
    isActive: true,
  },
};

const context = { params: Promise.resolve({ id: 'request-a' }) };

function jsonRequest(value: unknown) {
  return new Request('http://localhost/api/requests/request-a/award', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify(value),
  });
}

describe('comparison and award API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  });

  it('loads a private no-store factual comparison for the current tenant', async () => {
    jest.mocked(getQuoteComparison).mockResolvedValue({
      request: { id: 'request-a' },
      quotes: [{ quoteId: 'quote-a' }],
    } as never);

    const response = await comparisonRoute(
      new Request('http://localhost/api/requests/request-a/comparison'),
      context as never,
    );

    expect(getQuoteComparison).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' },
      requestId: 'request-a',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      request: { id: 'request-a' },
      quotes: [{ quoteId: 'quote-a' }],
    });
  });

  it('creates an award from account tenancy and never accepts client-derived actor fields', async () => {
    jest.mocked(createAward).mockResolvedValue({
      id: 'award-a',
      requestId: 'request-a',
      totalPaise: '8345000',
    } as never);
    const body = {
      mode: 'WHOLE',
      expectedRequestVersion: 2,
      supplierQuoteId: 'quote-a',
      rationale: 'Complete landed quote with delivery on time.',
      tenantId: 'tenant-b',
      awardedByUserId: 'owner-b',
      totalPaise: '1',
    };

    const response = await createAwardRoute(jsonRequest(body), context as never);

    expect(createAward).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' },
      requestId: 'request-a',
      award: body,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns safe authentication, validation, missing, and conflict errors', async () => {
    jest.mocked(requireAccountContext).mockResolvedValueOnce(null);
    const unauthorized = await comparisonRoute(
      new Request('http://localhost/api/requests/request-a/comparison'),
      context as never,
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('cache-control')).toBe('private, no-store');

    jest.mocked(getQuoteComparison).mockRejectedValueOnce(
      new QuoteComparisonNotFoundError(),
    );
    const missingComparison = await comparisonRoute(
      new Request('http://localhost/api/requests/private/comparison'),
      { params: Promise.resolve({ id: 'private' }) } as never,
    );
    expect(missingComparison.status).toBe(404);
    expect(missingComparison.headers.get('cache-control')).toBe('private, no-store');

    jest.mocked(createAward)
      .mockRejectedValueOnce(new AwardValidationError({ mode: ['Choose WHOLE or SPLIT.'] }))
      .mockRejectedValueOnce(new AwardNotFoundError())
      .mockRejectedValueOnce(new AwardConflictError('This request was already awarded.'));

    const invalid = await createAwardRoute(jsonRequest({}), context as never);
    const missing = await createAwardRoute(jsonRequest({}), context as never);
    const conflict = await createAwardRoute(jsonRequest({}), context as never);

    expect(invalid.status).toBe(422);
    expect(missing.status).toBe(404);
    expect(conflict.status).toBe(409);
    expect(invalid.headers.get('cache-control')).toBe('private, no-store');
    expect(missing.headers.get('cache-control')).toBe('private, no-store');
    expect(conflict.headers.get('cache-control')).toBe('private, no-store');
    await expect(conflict.json()).resolves.toMatchObject({
      detail: 'This request was already awarded.',
    });
  });

  it('maps an oversized trusted supplier snapshot to a bounded domain error', async () => {
    jest.mocked(createAward).mockRejectedValueOnce(
      new AwardSnapshotTooLargeError(),
    );

    const response = await createAwardRoute(
      jsonRequest({
        mode: 'WHOLE',
        expectedRequestVersion: 2,
        supplierQuoteId: 'quote-a',
        rationale: 'Human decision.',
      }),
      context as never,
    );

    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.json()).resolves.toMatchObject({
      title: 'Award snapshot is too large',
      detail: 'The selected supplier records exceed the supported award size.',
    });
  });

  it('bounds and strictly parses award JSON before invoking the service', async () => {
    const invalidJson = new Request(
      'http://localhost/api/requests/request-a/award',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      },
    );
    const tooLarge = new Request(
      'http://localhost/api/requests/request-a/award',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(512 * 1_024 + 1),
        },
        body: '{}',
      },
    );

    const invalidResponse = await createAwardRoute(invalidJson, context as never);
    const tooLargeResponse = await createAwardRoute(tooLarge, context as never);
    expect(invalidResponse.status).toBe(400);
    expect(tooLargeResponse.status).toBe(413);
    expect(invalidResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(tooLargeResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(createAward).not.toHaveBeenCalled();
  });

  it('rejects cross-origin and non-JSON mutations before authentication or parsing', async () => {
    const crossOrigin = new Request(
      'http://localhost/api/requests/request-a/award',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.example',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: '{}',
      },
    );
    const formEncoded = new Request(
      'http://localhost/api/requests/request-a/award',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: 'mode=WHOLE',
      },
    );

    const forbidden = await createAwardRoute(crossOrigin, context as never);
    const unsupported = await createAwardRoute(formEncoded, context as never);

    expect(forbidden.status).toBe(403);
    expect(unsupported.status).toBe(415);
    for (const response of [forbidden, unsupported]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-type')).toContain(
        'application/problem+json',
      );
    }
    expect(requireAccountContext).not.toHaveBeenCalled();
    expect(createAward).not.toHaveBeenCalled();
  });
});
