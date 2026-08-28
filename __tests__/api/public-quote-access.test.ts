import { createPublicQuoteAccessHandler } from '@/lib/security/public-quote-http';
import { PublicSupplierGrantError } from '@/lib/security/public-grant';

const token = 'A'.repeat(43);
const allowClient = jest.fn().mockResolvedValue({
  allowed: true,
  retryAfterSeconds: 900,
});

function jsonRequest(body: unknown) {
  return new Request('https://quoteplate.example/api/public/quote/access', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://quoteplate.example',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(body),
  });
}

describe('public quote access exchange', () => {
  it('exchanges a body token for a private same-site session cookie', async () => {
    const exchange = jest.fn().mockResolvedValue({
      tenantId: 'tenant-a',
      supplierRequestId: 'supplier-request-a',
    });
    const handler = createPublicQuoteAccessHandler({
      exchange,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      production: true,
      clientRateLimit: allowClient,
    });

    const response = await handler(jsonRequest({ token }));

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('set-cookie')).toContain(
      `quoteplate_supplier_session=${token}`,
    );
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')?.toLowerCase()).toContain(
      'samesite=strict',
    );
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/public/quote');
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(exchange).toHaveBeenCalledWith({
      token,
      now: new Date('2026-08-28T10:00:00.000Z'),
    });
  });

  it('rejects unknown fields, oversized bodies, and all unavailable grants safely', async () => {
    const exchange = jest.fn().mockRejectedValue(
      new PublicSupplierGrantError(
        'GRANT_UNAVAILABLE',
        410,
        'This supplier link is invalid or no longer available.',
      ),
    );
    const handler = createPublicQuoteAccessHandler({
      exchange,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      production: false,
      clientRateLimit: allowClient,
    });

    expect((await handler(jsonRequest({ token, tenantId: 'tenant-b' }))).status).toBe(400);
    expect(
      (await handler(jsonRequest({ token, tenantId: 'tenant-b' }))).headers.get(
        'cache-control',
      ),
    ).toBe('private, no-store');
    const oversized = new Request(
      'https://quoteplate.example/api/public/quote/access',
      {
        method: 'POST',
        headers: {
          'content-length': '2048',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ token }),
      },
    );
    expect((await handler(oversized)).status).toBe(413);

    const unavailable = await handler(jsonRequest({ token }));
    expect(unavailable.status).toBe(410);
    expect(unavailable.headers.get('set-cookie')).toContain(
      'quoteplate_supplier_session=;',
    );
    expect(unavailable.headers.get('set-cookie')).toContain('Max-Age=0');
    await expect(unavailable.json()).resolves.toEqual({
      type: 'about:blank',
      status: 410,
      title: 'Supplier link unavailable',
      detail: 'This supplier link is invalid or no longer available.',
    });
  });

  it('returns Retry-After when access attempts are limited', async () => {
    const handler = createPublicQuoteAccessHandler({
      exchange: jest.fn().mockRejectedValue(
        new PublicSupplierGrantError(
          'RATE_LIMITED',
          429,
          'Too many attempts. Try again later.',
          75,
        ),
      ),
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      production: false,
      clientRateLimit: allowClient,
    });

    const response = await handler(jsonRequest({ token }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('75');
  });

  it('requires JSON and rejects browser requests outside the exact origin', async () => {
    const exchange = jest.fn().mockResolvedValue({
      tenantId: 'tenant-a',
      supplierRequestId: 'supplier-request-a',
    });
    const handler = createPublicQuoteAccessHandler({
      exchange,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      production: true,
      clientRateLimit: allowClient,
    });

    const plainText = await handler(
      new Request('https://quoteplate.example/api/public/quote/access', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          origin: 'https://quoteplate.example',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ token }),
      }),
    );
    expect(plainText.status).toBe(415);

    const siblingOrigin = await handler(
      new Request('https://quoteplate.example/api/public/quote/access', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://offers.quoteplate.example',
          'sec-fetch-site': 'same-site',
        },
        body: JSON.stringify({ token }),
      }),
    );
    expect(siblingOrigin.status).toBe(403);

    const forgedFetchMetadata = await handler(
      new Request('https://quoteplate.example/api/public/quote/access', {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          origin: 'https://quoteplate.example',
          'sec-fetch-site': 'cross-site',
        },
        body: JSON.stringify({ token }),
      }),
    );
    expect(forgedFetchMetadata.status).toBe(403);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('limits the client before resolving even a well-formed unknown token', async () => {
    const exchange = jest.fn();
    const clientRateLimit = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 180,
    });
    const handler = createPublicQuoteAccessHandler({
      exchange,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      production: true,
      clientRateLimit,
    });
    const accessRequest = jsonRequest({ token });

    const response = await handler(accessRequest);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('180');
    expect(clientRateLimit).toHaveBeenCalledWith({
      request: accessRequest,
      now: new Date('2026-08-28T10:00:00.000Z'),
    });
    expect(exchange).not.toHaveBeenCalled();
  });
});
