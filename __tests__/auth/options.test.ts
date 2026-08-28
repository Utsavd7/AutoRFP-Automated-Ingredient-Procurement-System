import { createAuthOptions, googleAuthAvailable } from '@/lib/auth';

describe('NextAuth production options', () => {
  it('hides Google unless both OAuth secrets are configured', () => {
    expect(googleAuthAvailable({})).toBe(false);
    expect(googleAuthAvailable({ GOOGLE_CLIENT_ID: 'client' })).toBe(false);
    expect(
      googleAuthAvailable({
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
      }),
    ).toBe(true);

    const withoutGoogle = createAuthOptions({ env: {} });
    const withGoogle = createAuthOptions({
      env: {
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
      },
    });
    expect(withoutGoogle.providers.map((provider) => provider.id)).toEqual([
      'credentials',
    ]);
    expect(withGoogle.providers.map((provider) => provider.id)).toEqual([
      'credentials',
      'google',
    ]);
    expect(withGoogle.providers[1].options?.authorization?.params?.scope).toBe(
      'openid email profile',
    );
  });

  it('stores only userId and tenantId in the application JWT', async () => {
    const options = createAuthOptions({ env: {} });
    const jwt = options.callbacks?.jwt;
    if (!jwt) throw new Error('JWT callback missing');

    const result = await jwt({
      token: {
        sub: 'provider-sub',
        name: 'Old display name',
        email: 'old@example.com',
        picture: 'https://example.com/avatar.png',
      },
      user: {
        id: 'user-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      } as never,
      account: null,
      profile: undefined,
      trigger: 'signIn',
      isNewUser: false,
      session: undefined,
    });

    expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
  });

  it('does not preserve authorization when stable claims are absent', async () => {
    const options = createAuthOptions({ env: {} });
    const jwt = options.callbacks?.jwt;
    if (!jwt) throw new Error('JWT callback missing');

    const result = await jwt({
      token: { name: 'Asha', email: 'asha@example.com' },
      user: undefined as never,
      account: null,
      profile: undefined,
      trigger: 'update',
      isNewUser: false,
      session: undefined,
    });

    expect(result).toEqual({});
  });
});
