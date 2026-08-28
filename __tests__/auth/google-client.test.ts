import {
  beginGoogleAuthentication,
  loadGoogleProviderAvailability,
  type GoogleSignupFields,
} from '@/lib/auth/google-client';

const signup: GoogleSignupFields = {
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

describe('Google authentication client flow', () => {
  it('starts returning-user sign-in directly with Google', async () => {
    const fetcher = jest.fn();
    const googleSignIn = jest.fn().mockResolvedValue(undefined);

    await beginGoogleAuthentication(
      { mode: 'signin' },
      { fetcher, googleSignIn },
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(googleSignIn).toHaveBeenCalledWith('google');
  });

  it('stores every real workspace field before starting Google signup', async () => {
    const events: string[] = [];
    const fetcher = jest.fn(async (input: string, init?: RequestInit) => {
      events.push('onboarding');
      expect(input).toBe('/api/auth/start');
      expect(init).toEqual({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'google', ...signup }),
      });
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('password');
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, provider: 'google' }),
      };
    });
    const googleSignIn = jest.fn(async () => {
      events.push('google');
    });

    await beginGoogleAuthentication(
      { mode: 'signup', signup },
      { fetcher, googleSignIn },
    );

    expect(events).toEqual(['onboarding', 'google']);
    expect(googleSignIn).toHaveBeenCalledWith('google');
  });

  it('keeps the Google action unavailable when the providers endpoint omits it', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        credentials: {
          id: 'credentials',
          name: 'Email and password',
          type: 'credentials',
          signinUrl: 'http://localhost/api/auth/signin/credentials',
          callbackUrl: 'http://localhost/api/auth/callback/credentials',
        },
      }),
    });

    await expect(loadGoogleProviderAvailability(fetcher)).resolves.toBe(false);
  });
});
