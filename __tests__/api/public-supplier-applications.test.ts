import {
  createPublicSupplierApplicationHandler,
  PUBLIC_SUPPLIER_APPLICATION_BODY_BYTES,
} from '@/app/api/public/supplier-application/route';
import { PublicSupplierGrantError } from '@/lib/security/public-grant';
import {
  PublicSupplierApplicationUnavailableError,
  PublicSupplierApplicationValidationError,
} from '@/lib/suppliers/public-application-service';

const now = new Date('2027-01-08T09:00:00.000Z');
const token = 'A'.repeat(43);
const application = {
  token,
  businessName: 'Sahyadri Fresh Foods',
  phone: '9876543210',
  categories: ['VEGETABLES'],
};

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    'https://quoteplate.example/api/public/supplier-application',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://quoteplate.example',
        'sec-fetch-site': 'same-origin',
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

const allowClient = jest.fn().mockResolvedValue({
  allowed: true,
  retryAfterSeconds: 900,
});

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('public supplier application API', () => {
  beforeEach(() => allowClient.mockClear());

  it('returns only the indistinguishable 202 acceptance with private headers', async () => {
    const submit = jest.fn().mockResolvedValue({ accepted: true });
    const handler = createPublicSupplierApplicationHandler({
      submit,
      now: () => now,
      clientRateLimit: allowClient,
    });
    const request = jsonRequest(application);

    const response = await handler(request);

    expect(response.status).toBe(202);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(submit).toHaveBeenCalledWith({ application, now });
    expect(JSON.stringify(await (await handler(jsonRequest(application))).json()))
      .not.toMatch(/supplierId|tenantId|requestId|contact|token/i);
  });

  it('limits the client before token resolution and returns Retry-After', async () => {
    const submit = jest.fn();
    const clientRateLimit = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 75,
    });
    const handler = createPublicSupplierApplicationHandler({
      submit,
      now: () => now,
      clientRateLimit,
    });
    const request = jsonRequest(application);

    const response = await handler(request);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('75');
    expectPrivate(response);
    expect(clientRateLimit).toHaveBeenCalledWith({ request, now });
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects cross-origin, non-JSON, malformed, and oversized bodies before submission', async () => {
    const submit = jest.fn();
    const handler = createPublicSupplierApplicationHandler({
      submit,
      now: () => now,
      clientRateLimit: allowClient,
    });
    const requests = [
      jsonRequest(application, {
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      }),
      new Request(
        'https://quoteplate.example/api/public/supplier-application',
        {
          method: 'POST',
          headers: {
            'content-type': 'text/plain',
            origin: 'https://quoteplate.example',
            'sec-fetch-site': 'same-origin',
          },
          body: JSON.stringify(application),
        },
      ),
      new Request(
        'https://quoteplate.example/api/public/supplier-application',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://quoteplate.example',
            'sec-fetch-site': 'same-origin',
          },
          body: '{',
        },
      ),
      new Request(
        'https://quoteplate.example/api/public/supplier-application',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': String(
              PUBLIC_SUPPLIER_APPLICATION_BODY_BYTES + 1,
            ),
          },
          body: '{}',
        },
      ),
    ];

    const responses = [];
    for (const request of requests) responses.push(await handler(request));

    expect(responses.map(({ status }) => status)).toEqual([403, 415, 400, 413]);
    for (const response of responses) expectPrivate(response);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    [
      'invalid grant',
      new PublicSupplierGrantError(
        'GRANT_UNAVAILABLE',
        410,
        'database tenant secret',
      ),
      410,
    ],
    [
      'locked request mismatch',
      new PublicSupplierApplicationUnavailableError(),
      410,
    ],
    [
      'invalid application fields',
      new PublicSupplierApplicationValidationError({
        categories: ['Choose at least one supported category.'],
      }),
      422,
    ],
    ['unexpected failure', new Error('postgres password secret'), 503],
  ])('maps %s without leaking private context', async (_label, error, status) => {
    const handler = createPublicSupplierApplicationHandler({
      submit: jest.fn().mockRejectedValue(error),
      now: () => now,
      clientRateLimit: allowClient,
    });

    const response = await handler(jsonRequest(application));
    const payload = JSON.stringify(await response.json());

    expect(response.status).toBe(status);
    expectPrivate(response);
    expect(payload).not.toMatch(
      /database|postgres|password|tenantId|requestId|supplierId|token|contact/i,
    );
    if (status === 410) {
      expect(JSON.parse(payload)).toEqual({
        type: 'about:blank',
        status: 410,
        title: 'Application link unavailable',
        detail: 'This supplier application link is invalid or no longer available.',
      });
    }
  });

  it('maps the persistent request limiter without exposing the resolved request', async () => {
    const handler = createPublicSupplierApplicationHandler({
      submit: jest.fn().mockRejectedValue(
        new PublicSupplierGrantError(
          'RATE_LIMITED',
          429,
          'Too many attempts. Try again later.',
          120,
        ),
      ),
      now: () => now,
      clientRateLimit: allowClient,
    });

    const response = await handler(jsonRequest(application));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
    expectPrivate(response);
  });
});
