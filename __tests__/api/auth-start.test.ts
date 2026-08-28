import { createAuthStartHandler } from '@/lib/auth/start-handler';
import { EmailSignupError } from '@/lib/auth/email-signup';
import { readGoogleOnboardingCookie } from '@/lib/auth/oauth-start';

const workspace = {
  restaurantName: 'Tamarind Table',
  ownerName: 'Asha Rao',
  email: 'asha@example.com',
  addressLine: '12 Market Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560001',
  phone: '+919876543210',
  timezone: 'Asia/Kolkata',
  gstin: '',
};

function request(body: unknown) {
  return new Request('http://localhost/api/auth/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify(body),
  });
}

function allowRateLimit() {
  return jest.fn().mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 3_600,
  });
}

describe('POST /api/auth/start', () => {
  it('keeps production workspace creation inside the four-restaurant pilot', async () => {
    const emailSignup = jest.fn();
    const rateLimit = jest.fn();
    const handler = createAuthStartHandler({
      env: {
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
        NEXTAUTH_SECRET: 'test-secret-that-is-long-enough',
        QUOTEPLATE_PILOT_EMAILS: 'pilot-one@example.com,pilot-two@example.com',
      },
      emailSignup,
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit,
    });

    for (const method of ['email', 'google']) {
      const response = await handler(request({
        ...workspace,
        method,
        password: 'secure password',
      }));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'This pilot is available only to approved restaurant owners.',
      });
    }
    expect(rateLimit).not.toHaveBeenCalled();
    expect(emailSignup).not.toHaveBeenCalled();
  });

  it('uses verified Google—not an unverified password—to activate a production pilot owner', async () => {
    const emailSignup = jest.fn();
    const rateLimit = allowRateLimit();
    const handler = createAuthStartHandler({
      env: {
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
        NEXTAUTH_SECRET: 'test-secret-that-is-long-enough',
        QUOTEPLATE_PILOT_EMAILS: workspace.email,
      },
      emailSignup,
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit,
    });

    const response = await handler(request({
      ...workspace,
      method: 'email',
      password: 'secure password',
    }));

    expect(response.status).toBe(403);
    expect(emailSignup).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it('rejects cross-origin and non-JSON signup attempts before consuming quota', async () => {
    const emailSignup = jest.fn();
    const rateLimit = jest.fn();
    const handler = createAuthStartHandler({
      env: {},
      emailSignup,
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit,
    } as never);

    const crossOrigin = await handler(new Request('http://localhost/api/auth/start', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({ ...workspace, method: 'email', password: 'secure password' }),
    }));
    const wrongMedia = await handler(new Request('http://localhost/api/auth/start', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({ ...workspace, method: 'email', password: 'secure password' }),
    }));

    expect(crossOrigin.status).toBe(403);
    expect(wrongMedia.status).toBe(415);
    expect(crossOrigin.headers.get('cache-control')).toBe('private, no-store');
    expect(crossOrigin.headers.get('referrer-policy')).toBe('no-referrer');
    expect(crossOrigin.headers.get('x-content-type-options')).toBe('nosniff');
    expect(rateLimit).not.toHaveBeenCalled();
    expect(emailSignup).not.toHaveBeenCalled();
  });

  it('consumes a workspace-creation quota before expensive signup work', async () => {
    const emailSignup = jest.fn();
    const rateLimit = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 137,
    });
    const now = new Date('2026-08-28T00:00:00.000Z');
    const handler = createAuthStartHandler({
      env: {},
      emailSignup,
      now: () => now,
      rateLimit,
    } as never);

    const response = await handler(
      request({ ...workspace, method: 'email', password: 'secure password' }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('137');
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to create the workspace right now. Try again shortly.',
    });
    expect(rateLimit).toHaveBeenCalledWith({
      email: workspace.email,
      request: expect.any(Request),
      now,
    });
    expect(emailSignup).not.toHaveBeenCalled();
  });

  it('returns an opaque success for an already-registered email', async () => {
    const handler = createAuthStartHandler({
      env: {},
      emailSignup: jest.fn().mockRejectedValue(
        new EmailSignupError(
          'EMAIL_ALREADY_REGISTERED',
          409,
          'A workspace already exists for that email. Use Sign in instead.',
        ),
      ),
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit: jest.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 3_600,
      }),
    } as never);

    const response = await handler(
      request({ ...workspace, method: 'email', password: 'secure password' }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('rejects an oversized signup body before quota or password work', async () => {
    const emailSignup = jest.fn();
    const rateLimit = jest.fn();
    const handler = createAuthStartHandler({
      env: {},
      emailSignup,
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit,
    } as never);
    const oversized = new Request('http://localhost/api/auth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...workspace,
        method: 'email',
        password: 'x'.repeat(20_000),
      }),
    });

    const response = await handler(oversized);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: 'Signup details must be smaller than 16 KB.',
    });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(emailSignup).not.toHaveBeenCalled();
  });

  it('rejects an unknown or missing signup method', async () => {
    const emailSignup = jest.fn();
    const handler = createAuthStartHandler({
      env: {},
      emailSignup,
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit: allowRateLimit(),
    });

    for (const method of [undefined, 'magic-link']) {
      const response = await handler(request({ ...workspace, method }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Choose email or Google signup.',
      });
    }
    expect(emailSignup).not.toHaveBeenCalled();
  });

  it('creates an email workspace without establishing a client-authoritative session', async () => {
    const emailSignup = jest.fn().mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    const handler = createAuthStartHandler({
      env: {},
      emailSignup,
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit: allowRateLimit(),
    });

    const response = await handler(
      request({ ...workspace, method: 'email', password: 'secure password' }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(emailSignup).toHaveBeenCalledWith({
      ...workspace,
      method: 'email',
      password: 'secure password',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('does not expose unexpected signup internals', async () => {
    const handler = createAuthStartHandler({
      env: {},
      emailSignup: jest
        .fn()
        .mockRejectedValue(new Error('database password leaked in driver error')),
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit: allowRateLimit(),
    });

    const response = await handler(
      request({ ...workspace, method: 'email', password: 'secure password' }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to create the workspace right now. Try again shortly.',
    });
  });

  it('reports Google as unavailable unless both secrets exist', async () => {
    const handler = createAuthStartHandler({
      env: { GOOGLE_CLIENT_ID: 'client-only' },
      emailSignup: jest.fn(),
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit: allowRateLimit(),
    });

    const response = await handler(request({ ...workspace, method: 'google' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Google sign-in is not configured. Use email and password.',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('sets only an encrypted onboarding cookie for Google signup', async () => {
    const secret = 'test-secret-that-is-long-enough';
    const handler = createAuthStartHandler({
      env: {
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
        NEXTAUTH_SECRET: secret,
        NODE_ENV: 'production',
        QUOTEPLATE_PILOT_EMAILS: workspace.email,
      },
      emailSignup: jest.fn(),
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit: allowRateLimit(),
    });

    const response = await handler(request({ ...workspace, method: 'google' }));
    const setCookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    const data = await response.json() as {
      ok: boolean;
      provider: string;
      flowId?: string;
    };
    expect(data).toEqual({
      ok: true,
      provider: 'google',
      flowId: expect.stringMatching(/^[A-Za-z0-9_-]{20,64}$/),
    });
    expect(setCookie).toContain(`autorfp.google-onboarding.${data.flowId}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=lax');
    expect(setCookie).toContain('Secure');
    expect(setCookie).not.toContain('Tamarind Table');
    const encoded = setCookie?.split(';')[0].split('=')[1];
    expect(
      readGoogleOnboardingCookie(encoded, {
        secret,
        now: new Date('2026-08-28T00:01:00.000Z'),
      }),
    ).toMatchObject({
      restaurantName: 'Tamarind Table',
      ownerName: 'Asha Rao',
      email: 'asha@example.com',
      pin: '560001',
      flowId: data.flowId,
    });
  });

  it('returns a safe validation error instead of emitting an oversized multibyte cookie', async () => {
    const handler = createAuthStartHandler({
      env: {
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
        NEXTAUTH_SECRET: 'test-secret-that-is-long-enough',
        NODE_ENV: 'production',
        QUOTEPLATE_PILOT_EMAILS: workspace.email,
      },
      emailSignup: jest.fn(),
      now: () => new Date('2026-08-28T00:00:00.000Z'),
      rateLimit: allowRateLimit(),
    });

    const response = await handler(request({
      ...workspace,
      method: 'google',
      restaurantName: '店'.repeat(200),
      ownerName: '厨'.repeat(200),
      addressLine: '界'.repeat(500),
      city: '市'.repeat(120),
      state: '州'.repeat(120),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        'Workspace details are too long for Google sign up. Shorten the restaurant name or address.',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
