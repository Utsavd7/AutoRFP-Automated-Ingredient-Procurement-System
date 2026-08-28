import {
  createRequestAuthOptions,
  shouldClearGoogleOnboarding,
} from '@/lib/auth/request-options';
import type { GoogleIdentityRepository } from '@/lib/auth/google-identity';
import {
  GOOGLE_ONBOARDING_COOKIE,
  createGoogleOnboardingCookie,
} from '@/lib/auth/oauth-start';

const env = {
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
  NEXTAUTH_SECRET: 'test-secret-that-is-long-enough',
};

function onboardingCookie(restaurantName: string, email: string) {
  return createGoogleOnboardingCookie(
    {
      restaurantName,
      ownerName: 'Asha Rao',
      email,
      addressLine: '12 Market Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin: '560001',
      phone: '+919876543210',
    },
    {
      secret: env.NEXTAUTH_SECRET,
      now: new Date('2026-08-28T00:00:00.000Z'),
      secure: false,
    },
  );
}

function repository(
  identity: { userId: string; tenantId: string; email: string },
): GoogleIdentityRepository {
  return {
    findIdentity: jest.fn().mockResolvedValue(null),
    findUserByEmail: jest.fn().mockResolvedValue(null),
    createOwnerIdentity: jest.fn().mockResolvedValue({
      ...identity,
      name: 'Asha Rao',
      role: 'OWNER',
      userIsActive: true,
      tenantIsActive: true,
    }),
    touchLogin: jest.fn(),
  };
}

async function runGoogleCallback(
  options: ReturnType<typeof createRequestAuthOptions>,
  email: string,
  providerAccountId: string,
) {
  const signIn = options.callbacks?.signIn;
  const jwt = options.callbacks?.jwt;
  if (!signIn || !jwt) throw new Error('callbacks missing');
  const account = { provider: 'google', providerAccountId, type: 'oauth' as const };
  const profile = {
    sub: providerAccountId,
    email,
    email_verified: true,
    name: 'Asha Rao',
  };
  await signIn({ user: { id: providerAccountId }, account, profile });
  return jwt({
    token: {},
    user: { id: providerAccountId },
    account,
    profile,
    trigger: 'signIn',
    isNewUser: false,
    session: undefined,
  });
}

describe('request-scoped NextAuth options', () => {
  it('never applies an abandoned signup cookie to a normal Google sign-in callback', async () => {
    const abandoned = createGoogleOnboardingCookie(
      {
        restaurantName: 'Abandoned Signup',
        ownerName: 'Asha Rao',
        email: 'asha@example.com',
        addressLine: '12 Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pin: '560001',
        phone: '+919876543210',
      },
      {
        secret: env.NEXTAUTH_SECRET,
        now: new Date('2026-08-28T00:00:00.000Z'),
        secure: false,
      },
    );
    const abandonedRepo = repository({
      userId: 'should-not-exist',
      tenantId: 'should-not-exist',
      email: 'asha@example.com',
    });
    const options = createRequestAuthOptions(
      new Request(
        'http://localhost/api/auth/callback/google?state=normal-signin-state',
        { headers: { cookie: `${abandoned.name}=${abandoned.value}` } },
      ),
      {
        env,
        now: new Date('2026-08-28T00:01:00.000Z'),
        googleIdentityRepository: abandonedRepo,
      },
    );

    await expect(
      runGoogleCallback(options, 'asha@example.com', 'normal-signin-google-id'),
    ).rejects.toThrow('No workspace is connected');
    expect(abandonedRepo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('does not load a state-bound onboarding cookie outside the Google callback route', async () => {
    const signup = onboardingCookie('Bound Kitchen', 'asha@example.com');
    const signupRepo = repository({
      userId: 'should-not-exist',
      tenantId: 'should-not-exist',
      email: 'asha@example.com',
    });
    const options = createRequestAuthOptions(
      new Request(
        'http://localhost/api/auth/signin/google?state=bound-route-state',
        {
          headers: {
            cookie: `${GOOGLE_ONBOARDING_COOKIE}.oauth.bound-route-state=${signup.value}`,
          },
        },
      ),
      {
        env,
        now: new Date('2026-08-28T00:01:00.000Z'),
        googleIdentityRepository: signupRepo,
      },
    );

    await expect(
      runGoogleCallback(options, 'asha@example.com', 'google-outside-callback'),
    ).rejects.toThrow('No workspace is connected');
    expect(signupRepo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('selects only the OAuth-state-bound onboarding cookie when callbacks arrive out of order', async () => {
    const firstCookie = createGoogleOnboardingCookie(
      {
        restaurantName: 'First Kitchen',
        ownerName: 'Asha Rao',
        email: 'asha@example.com',
        addressLine: '12 Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pin: '560001',
        phone: '+919876543210',
      },
      {
        secret: env.NEXTAUTH_SECRET,
        now: new Date('2026-08-28T00:00:00.000Z'),
        secure: false,
      },
    );
    const secondCookie = createGoogleOnboardingCookie(
      {
        restaurantName: 'Second Kitchen',
        ownerName: 'Bea Rao',
        email: 'bea@example.com',
        addressLine: '14 Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pin: '560001',
        phone: '+919876543211',
      },
      {
        secret: env.NEXTAUTH_SECRET,
        now: new Date('2026-08-28T00:00:00.000Z'),
        secure: false,
      },
    );
    const cookies = [
      `${GOOGLE_ONBOARDING_COOKIE}.oauth.first-state=${firstCookie.value}`,
      `${GOOGLE_ONBOARDING_COOKIE}.oauth.second-state=${secondCookie.value}`,
    ].join('; ');
    const firstRepo = repository({
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'asha@example.com',
    });
    const secondRepo = repository({
      userId: 'user-2',
      tenantId: 'tenant-2',
      email: 'bea@example.com',
    });

    const second = createRequestAuthOptions(
      new Request(
        'http://localhost/api/auth/callback/google?state=second-state',
        { headers: { cookie: cookies } },
      ),
      {
        env,
        now: new Date('2026-08-28T00:01:00.000Z'),
        googleIdentityRepository: secondRepo,
      },
    );
    const first = createRequestAuthOptions(
      new Request(
        'http://localhost/api/auth/callback/google?state=first-state',
        { headers: { cookie: cookies } },
      ),
      {
        env,
        now: new Date('2026-08-28T00:01:00.000Z'),
        googleIdentityRepository: firstRepo,
      },
    );

    await expect(
      runGoogleCallback(second, 'bea@example.com', 'google-2'),
    ).resolves.toEqual({ userId: 'user-2', tenantId: 'tenant-2' });
    await expect(
      runGoogleCallback(first, 'asha@example.com', 'google-1'),
    ).resolves.toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
    expect(secondRepo.createOwnerIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantName: 'Second Kitchen' }),
    );
    expect(firstRepo.createOwnerIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantName: 'First Kitchen' }),
    );
  });

  it('keeps Google signup state isolated between callback requests', async () => {
    const firstRepo = repository({
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'asha@example.com',
    });
    const secondRepo = repository({
      userId: 'user-2',
      tenantId: 'tenant-2',
      email: 'bea@example.com',
    });
    const firstOnboarding = onboardingCookie(
      'Tamarind Table',
      'asha@example.com',
    );
    const secondOnboarding = onboardingCookie(
      'Basil House',
      'bea@example.com',
    );
    const first = createRequestAuthOptions(
      new Request('http://localhost/api/auth/callback/google?state=isolated-first', {
        headers: {
          cookie: `${GOOGLE_ONBOARDING_COOKIE}.oauth.isolated-first=${firstOnboarding.value}`,
        },
      }),
      {
        env,
        now: new Date('2026-08-28T00:01:00.000Z'),
        googleIdentityRepository: firstRepo,
      },
    );
    const second = createRequestAuthOptions(
      new Request('http://localhost/api/auth/callback/google?state=isolated-second', {
        headers: {
          cookie: `${GOOGLE_ONBOARDING_COOKIE}.oauth.isolated-second=${secondOnboarding.value}`,
        },
      }),
      {
        env,
        now: new Date('2026-08-28T00:01:00.000Z'),
        googleIdentityRepository: secondRepo,
      },
    );

    await expect(
      runGoogleCallback(first, 'asha@example.com', 'google-1'),
    ).resolves.toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
    await expect(
      runGoogleCallback(second, 'bea@example.com', 'google-2'),
    ).resolves.toEqual({ userId: 'user-2', tenantId: 'tenant-2' });
    expect(firstRepo.createOwnerIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantName: 'Tamarind Table' }),
    );
    expect(secondRepo.createOwnerIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantName: 'Basil House' }),
    );
  });

  it('clears onboarding only after the Google callback', () => {
    expect(
      shouldClearGoogleOnboarding(
        new Request('http://localhost/api/auth/callback/google'),
      ),
    ).toBe(true);
    expect(
      shouldClearGoogleOnboarding(
        new Request('http://localhost/api/auth/signin/google'),
      ),
    ).toBe(false);
    expect(
      shouldClearGoogleOnboarding(
        new Request('http://localhost/api/auth/signout'),
      ),
    ).toBe(false);
  });
});
