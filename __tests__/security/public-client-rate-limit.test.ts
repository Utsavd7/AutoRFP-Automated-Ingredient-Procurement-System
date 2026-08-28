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

  it('keeps distinct Netlify-provided production clients in distinct buckets', () => {
    const first = new Headers({
      'x-nf-client-connection-ip': '198.51.100.20',
      'cf-connecting-ip': '192.0.2.1',
    });
    const second = new Headers({
      'x-nf-client-connection-ip': '203.0.113.20',
      'cf-connecting-ip': '192.0.2.1',
    });

    expect(publicClientRateLimitDigest(
      'quote-access',
      first,
      { NODE_ENV: 'production' },
    )).not.toBe(publicClientRateLimitDigest(
      'quote-access',
      second,
      { NODE_ENV: 'production' },
    ));
  });
});
