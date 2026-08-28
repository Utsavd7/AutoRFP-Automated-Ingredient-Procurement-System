import { createAuthStartHandler } from '@/lib/auth/start-handler';
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/start', () => {
  it('rejects an unknown or missing signup method', async () => {
    const emailSignup = jest.fn();
    const handler = createAuthStartHandler({
      env: {},
      emailSignup,
      now: () => new Date('2026-08-28T00:00:00.000Z'),
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
      },
      emailSignup: jest.fn(),
      now: () => new Date('2026-08-28T00:00:00.000Z'),
    });

    const response = await handler(request({ ...workspace, method: 'google' }));
    const setCookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      provider: 'google',
    });
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
    });
  });
});
