import {
  browserJsonMutationRejection,
  browserMutationOriginRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

describe('browser mutation protection', () => {
  it('rejects cross-origin and cross-site browser requests before media checks', () => {
    expect(browserMutationOriginRejection(new Request('https://quoteplate.example/api/suppliers', {
      method: 'DELETE',
      headers: { Origin: 'https://attacker.example' },
    }))).toBe('CROSS_ORIGIN');
    expect(browserJsonMutationRejection(new Request('https://quoteplate.example/api/requests', {
      method: 'POST',
      headers: {
        Origin: 'https://quoteplate.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
    }))).toBe('CROSS_ORIGIN');
  });

  it('allows same-origin bodyless mutations while JSON mutations still require JSON', () => {
    const sameOriginDelete = new Request('https://quoteplate.example/api/suppliers/one', {
      method: 'DELETE', headers: { Origin: 'https://quoteplate.example', 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(browserMutationOriginRejection(sameOriginDelete)).toBeNull();

    expect(browserJsonMutationRejection(new Request('https://quoteplate.example/api/requests', {
      method: 'POST', headers: { Origin: 'https://quoteplate.example', 'Content-Type': 'text/plain' },
    }))).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(browserJsonMutationRejection(new Request('https://quoteplate.example/api/requests', {
      method: 'POST', headers: { Origin: 'https://quoteplate.example', 'Content-Type': 'application/json; charset=utf-8' },
    }))).toBeNull();
  });

  it('accepts the configured public origin when a reverse proxy rewrites the request URL', () => {
    const proxied = new Request('http://internal-next:3000/api/settings', {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.quoteplate.in',
        Host: 'internal-next:3000',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
      },
    });
    expect(browserJsonMutationRejection(proxied, {
      NEXTAUTH_URL: 'https://app.quoteplate.in',
    })).toBeNull();

    const attacker = new Request('http://internal-next:3000/api/settings', {
      method: 'PATCH',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
    });
    expect(browserJsonMutationRejection(attacker, {
      NEXTAUTH_URL: 'https://app.quoteplate.in',
    })).toBe('CROSS_ORIGIN');
  });

  it('marks private mutation responses as non-cacheable and non-referring', () => {
    const response = privateMutationResponse(Response.json({ secret: 'tenant data' }));

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
