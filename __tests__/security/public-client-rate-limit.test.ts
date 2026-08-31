import { publicClientRateLimitDigest } from '@/lib/security/public-client-rate-limit';

describe('public client rate-limit identity', () => {
  it('uses one non-spoofable production bucket when host client IP metadata is unavailable', () => {
    const first = new Headers({
      'cf-connecting-ip': '198.51.100.1',
      'x-real-ip': '198.51.100.2',
      'x-forwarded-for': '198.51.100.3',
    });
    const rotated = new Headers({
      'cf-connecting-ip': '203.0.113.10',
      'x-real-ip': '203.0.113.11',
      'x-forwarded-for': '203.0.113.12',
    });

    expect(publicClientRateLimitDigest(
      'quote-access',
      first,
      { NODE_ENV: 'production' },
    )).toBe(publicClientRateLimitDigest(
      'quote-access',
      rotated,
      { NODE_ENV: 'production' },
    ));
  });

  it('keeps distinct Vercel-provided production clients in distinct buckets', () => {
    const first = new Headers({
      'x-vercel-forwarded-for': '198.51.100.20',
      'x-forwarded-for': '192.0.2.1',
    });
    const second = new Headers({
      'x-vercel-forwarded-for': '203.0.113.20',
      'x-forwarded-for': '192.0.2.1',
    });

    expect(publicClientRateLimitDigest(
      'quote-access',
      first,
      { NODE_ENV: 'production', VERCEL: '1' },
    )).not.toBe(publicClientRateLimitDigest(
      'quote-access',
      second,
      { NODE_ENV: 'production', VERCEL: '1' },
    ));
  });

  it('uses Netlify client metadata only with trusted Netlify runtime markers', () => {
    const first = new Headers({
      'x-nf-client-connection-ip': '198.51.100.30',
      'x-forwarded-for': '192.0.2.1',
    });
    const second = new Headers({
      'x-nf-client-connection-ip': '203.0.113.30',
      'x-forwarded-for': '192.0.2.1',
    });
    const trustedNetlify = {
      NODE_ENV: 'production',
      SITE_ID: 'site-a',
      URL: 'https://quoteplate.example',
    };

    expect(publicClientRateLimitDigest(
      'supplier-application', first, trustedNetlify,
    )).not.toBe(publicClientRateLimitDigest(
      'supplier-application', second, trustedNetlify,
    ));

    expect(publicClientRateLimitDigest(
      'supplier-application', first, { NODE_ENV: 'production' },
    )).toBe(publicClientRateLimitDigest(
      'supplier-application', second, { NODE_ENV: 'production' },
    ));
    expect(publicClientRateLimitDigest(
      'supplier-application', first,
      { NODE_ENV: 'production', NETLIFY: 'true' },
    )).toBe(publicClientRateLimitDigest(
      'supplier-application', second,
      { NODE_ENV: 'production', NETLIFY: 'true' },
    ));
  });
});
