import { createPublicQuoteHandlers } from '@/lib/quotes/public-quote-http';
import {
  PublicQuoteDocumentSizeError,
  PublicQuoteRevisionConflictError,
  PublicQuoteRevisionLimitError,
  PublicQuoteSubmissionLimitError,
  PublicQuoteUnavailableError,
  PublicQuoteValidationError,
} from '@/lib/quotes/public-quote-service';

const token = 'Q'.repeat(43);

function request(method: 'GET' | 'POST', body?: unknown, cookie = token) {
  return new Request('https://quoteplate.example/api/public/quote', {
    method,
    headers: {
      ...(cookie
        ? { cookie: `theme=light; quoteplate_supplier_session=${cookie}` }
        : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(body === undefined
        ? {}
        : {
            origin: 'https://quoteplate.example',
            'sec-fetch-site': 'same-origin',
          }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('public supplier quote API', () => {
  it('loads a private request using only the HttpOnly session cookie', async () => {
    const load = jest.fn().mockResolvedValue({
      restaurantName: 'Monsoon Table Pune',
      supplierName: 'Shakti Fresh Foods',
      title: 'Weekly vegetables',
      items: [],
      latestQuote: null,
    });
    const handlers = createPublicQuoteHandlers({
      load,
      submit: jest.fn(),
    });

    const response = await handlers.GET(request('GET'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(load).toHaveBeenCalledWith({ token });
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ restaurantName: 'Monsoon Table Pune' }),
    );
  });

  it('creates a calculated revision from bounded JSON', async () => {
    const submit = jest.fn().mockResolvedValue({
      revision: 1,
      subtotalPaise: '420000',
      gstPaise: '21000',
      freightPaise: '45000',
      totalPaise: '486000',
    });
    const handlers = createPublicQuoteHandlers({
      load: jest.fn(),
      submit,
      submissionClientRateLimit: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 900,
      }),
    });
    const quote = { expectedLatestRevision: 0, items: [] };

    const response = await handlers.POST(request('POST', quote));

    expect(response.status).toBe(201);
    expect(submit).toHaveBeenCalledWith({ token, quote });
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ revision: 1, totalPaise: '486000' }),
    );
  });

  it('returns a retryable response when a valid supplier link reaches its revision quota', async () => {
    const submit = jest.fn().mockRejectedValue(
      new PublicQuoteSubmissionLimitError(321),
    );
    const handlers = createPublicQuoteHandlers({
      load: jest.fn(),
      submit,
      submissionClientRateLimit: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 900,
      }),
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });

    const response = await handlers.POST(
      request('POST', { expectedLatestRevision: 0, items: [] }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('321');
    expect(submit).toHaveBeenCalledWith({
      token,
      quote: { expectedLatestRevision: 0, items: [] },
    });
  });

  it('uses one unavailable response for missing, malformed, revoked, and expired sessions', async () => {
    const load = jest.fn().mockRejectedValue(new PublicQuoteUnavailableError());
    const handlers = createPublicQuoteHandlers({
      load,
      submit: jest.fn(),
    });

    for (const candidate of ['', 'bad-token', token]) {
      const response = await handlers.GET(request('GET', undefined, candidate));
      expect(response.status).toBe(410);
      expect(response.headers.get('set-cookie')).toContain(
        'quoteplate_supplier_session=;'
      );
      await expect(response.json()).resolves.toEqual({
        type: 'about:blank',
        status: 410,
        title: 'Supplier link unavailable',
        detail: 'This supplier link is invalid or no longer available.',
      });
    }
  });

  it('maps validation, stale revision, oversized body, and internal failures safely', async () => {
    const validation = new PublicQuoteValidationError({
      'items.0.unitRateInr': ['Enter a valid rate.'],
    });
    const submit = jest
      .fn()
      .mockRejectedValueOnce(validation)
      .mockRejectedValueOnce(new PublicQuoteRevisionConflictError())
      .mockRejectedValueOnce(new Error('database password secret'));
    const handlers = createPublicQuoteHandlers({
      load: jest.fn(),
      submit,
      submissionClientRateLimit: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 900,
      }),
    });

    const invalid = await handlers.POST(request('POST', {}));
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toEqual(
      expect.objectContaining({
        errors: { 'items.0.unitRateInr': ['Enter a valid rate.'] },
      }),
    );

    expect((await handlers.POST(request('POST', {}))).status).toBe(409);

    const failed = await handlers.POST(request('POST', {}));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('password');

    const oversized = new Request(
      'https://quoteplate.example/api/public/quote',
      {
        method: 'POST',
        headers: {
          cookie: `quoteplate_supplier_session=${token}`,
          'content-length': String(1_024 * 1_024 + 1),
          'content-type': 'application/json',
        },
        body: '{}',
      },
    );
    expect((await handlers.POST(oversized)).status).toBe(413);
  });

  it.each([
    new PublicQuoteRevisionConflictError(),
    new PublicQuoteRevisionLimitError(),
    new PublicQuoteDocumentSizeError(),
  ])('maps safe revision conflicts to 409 without losing privacy headers', async (error) => {
    const handlers = createPublicQuoteHandlers({
      load: jest.fn(),
      submit: jest.fn().mockRejectedValue(error),
      submissionClientRateLimit: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 900,
      }),
    });

    const response = await handlers.POST(request('POST', {}));

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('requires JSON and rejects cookie-authenticated mutations outside the exact origin', async () => {
    const submit = jest.fn().mockResolvedValue({ revision: 1 });
    const handlers = createPublicQuoteHandlers({ load: jest.fn(), submit });
    const quote = { expectedLatestRevision: 0, items: [] };

    const plainText = await handlers.POST(
      new Request('https://quoteplate.example/api/public/quote', {
        method: 'POST',
        headers: {
          cookie: `quoteplate_supplier_session=${token}`,
          'content-type': 'text/plain',
          origin: 'https://quoteplate.example',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify(quote),
      }),
    );
    expect(plainText.status).toBe(415);

    const siblingOrigin = await handlers.POST(
      new Request('https://quoteplate.example/api/public/quote', {
        method: 'POST',
        headers: {
          cookie: `quoteplate_supplier_session=${token}`,
          'content-type': 'application/json',
          origin: 'https://offers.quoteplate.example',
          'sec-fetch-site': 'same-site',
        },
        body: JSON.stringify(quote),
      }),
    );
    expect(siblingOrigin.status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });

  it('limits a submitting client before consuming token buckets or resolving grants', async () => {
    const submit = jest.fn();
    const submissionClientRateLimit = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 75,
    });
    const handlers = createPublicQuoteHandlers({
      load: jest.fn(),
      submit,
      submissionClientRateLimit,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });
    const submitRequest = request('POST', {
      expectedLatestRevision: 0,
      items: [],
    });

    const response = await handlers.POST(submitRequest);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('75');
    expect(submissionClientRateLimit).toHaveBeenCalledWith({
      request: submitRequest,
      now: new Date('2026-08-28T10:00:00.000Z'),
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
