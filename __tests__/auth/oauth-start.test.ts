import {
  GOOGLE_ONBOARDING_COOKIE,
  createGoogleOnboardingCookie,
  readGoogleOnboardingCookie,
} from '@/lib/auth/oauth-start';

const onboarding = {
  restaurantName: '  Tamarind Table  ',
  ownerName: '  Asha Rao  ',
  email: ' ASHA@EXAMPLE.COM ',
  addressLine: '12 Market Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560001',
  phone: '+91 98765 43210',
  timezone: 'Asia/Kolkata',
  gstin: '29ABCDE1234F1Z5',
};

describe('Google signup onboarding cookie', () => {
  it('encrypts normalized India workspace details in a short-lived HttpOnly cookie', () => {
    const now = new Date('2026-08-28T00:00:00.000Z');
    const cookie = createGoogleOnboardingCookie(onboarding, {
      secret: 'test-secret-that-is-long-enough',
      now,
      secure: true,
    });

    expect(cookie.name).toBe(GOOGLE_ONBOARDING_COOKIE);
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/api/auth',
      maxAge: 600,
    });
    expect(cookie.value).not.toContain('Tamarind');
    expect(cookie.value).not.toContain('ASHA@EXAMPLE.COM');
    expect(
      readGoogleOnboardingCookie(cookie.value, {
        secret: 'test-secret-that-is-long-enough',
        now: new Date('2026-08-28T00:09:59.000Z'),
      }),
    ).toEqual({
      restaurantName: 'Tamarind Table',
      ownerName: 'Asha Rao',
      email: 'asha@example.com',
      addressLine: '12 Market Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin: '560001',
      phone: '+91 98765 43210',
      timezone: 'Asia/Kolkata',
      gstin: '29ABCDE1234F1Z5',
      expiresAt: '2026-08-28T00:10:00.000Z',
    });
  });

  it('rejects expired, tampered, or differently domain-keyed cookies', () => {
    const cookie = createGoogleOnboardingCookie(onboarding, {
      secret: 'test-secret-that-is-long-enough',
      now: new Date('2026-08-28T00:00:00.000Z'),
      secure: false,
    });
    const tampered = `${cookie.value.slice(0, -1)}${
      cookie.value.endsWith('a') ? 'b' : 'a'
    }`;

    expect(
      readGoogleOnboardingCookie(cookie.value, {
        secret: 'test-secret-that-is-long-enough',
        now: new Date('2026-08-28T00:10:01.000Z'),
      }),
    ).toBeNull();
    expect(
      readGoogleOnboardingCookie(tampered, {
        secret: 'test-secret-that-is-long-enough',
        now: new Date('2026-08-28T00:01:00.000Z'),
      }),
    ).toBeNull();
    expect(
      readGoogleOnboardingCookie(cookie.value, {
        secret: 'different-secret-that-is-long-enough',
        now: new Date('2026-08-28T00:01:00.000Z'),
      }),
    ).toBeNull();
  });

  it('rejects invalid GSTIN and bounded-field violations before encryption', () => {
    expect(() =>
      createGoogleOnboardingCookie(
        { ...onboarding, gstin: 'not-a-gstin' },
        {
          secret: 'test-secret-that-is-long-enough',
          now: new Date('2026-08-28T00:00:00.000Z'),
          secure: false,
        },
      ),
    ).toThrow('valid GSTIN');
    expect(() =>
      createGoogleOnboardingCookie(
        { ...onboarding, restaurantName: 'x'.repeat(201) },
        {
          secret: 'test-secret-that-is-long-enough',
          now: new Date('2026-08-28T00:00:00.000Z'),
          secure: false,
        },
      ),
    ).toThrow('too long');
  });
});
