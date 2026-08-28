import {
  authClientIdentifier,
  consumeCredentialsRateLimit,
  consumeWorkspaceCreationRateLimit,
  digestAuthRateLimitSubject,
} from '@/lib/auth/rate-limit';

const now = new Date('2026-08-28T00:00:00.000Z');

describe('auth rate-limit subjects', () => {
  it('normalizes proxy identity and keeps email/client digest domains separate', () => {
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.4, 203.0.113.9',
    });

    expect(authClientIdentifier(headers)).toBe('203.0.113.9');
    expect(digestAuthRateLimitSubject('email', 'asha@example.com')).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(digestAuthRateLimitSubject('email', 'asha@example.com')).not.toBe(
      digestAuthRateLimitSubject('client', 'asha@example.com'),
    );
    expect(digestAuthRateLimitSubject('email', 'asha@example.com')).not.toContain(
      'asha@example.com',
    );
  });

  it('does not trust caller-controlled forwarding headers in production', () => {
    expect(authClientIdentifier(
      new Headers({
        'cf-connecting-ip': '198.51.100.1',
        'x-real-ip': '198.51.100.2',
        'x-forwarded-for': '198.51.100.3',
      }),
      { NODE_ENV: 'production' },
    )).toBe('production-unidentified');
    expect(authClientIdentifier(
      new Headers({
        'x-nf-client-connection-ip': '203.0.113.20',
        'cf-connecting-ip': '198.51.100.1',
      }),
      { NODE_ENV: 'production' },
    )).toBe('203.0.113.20');
  });

  it('consumes separate email and client buckets for workspace creation', async () => {
    const consume = jest.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 3_600,
    });

    await expect(
      consumeWorkspaceCreationRateLimit(
        {
          email: ' ASHA@EXAMPLE.COM ',
          request: new Request('https://quoteplate.example/api/auth/start', {
            headers: { 'x-real-ip': '203.0.113.9' },
          }),
          now,
        },
        consume,
      ),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 3_600 });
    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenCalledWith({
      scope: 'auth-workspace-create-email',
      subjectDigest: digestAuthRateLimitSubject('email', 'asha@example.com'),
      limit: 5,
      windowMs: 3_600_000,
      now,
    });
    expect(consume).toHaveBeenCalledWith({
      scope: 'auth-workspace-create-client',
      subjectDigest: digestAuthRateLimitSubject('client', '203.0.113.9'),
      limit: 30,
      windowMs: 3_600_000,
      now,
    });
  });

  it('stops before creating an email bucket when the client bucket is exhausted', async () => {
    const consume = jest
      .fn()
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 240 });

    await expect(
      consumeCredentialsRateLimit(
        {
          email: 'asha@example.com',
          clientIdentifier: '203.0.113.9',
          now,
        },
        consume,
      ),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 240 });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls.map(([input]) => input.scope)).toEqual([
      'auth-credentials-client',
    ]);
  });

  it('consumes the email bucket only after the client bucket allows the attempt', async () => {
    const consume = jest
      .fn()
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 120 })
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 240 });

    await expect(
      consumeCredentialsRateLimit(
        {
          email: 'asha@example.com',
          clientIdentifier: '203.0.113.9',
          now,
        },
        consume,
      ),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 240 });
    expect(consume.mock.calls.map(([input]) => input.scope)).toEqual([
      'auth-credentials-client',
      'auth-credentials-email',
    ]);
  });
});
