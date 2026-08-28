export type GoogleSignupFields = {
  restaurantName: string;
  ownerName: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  phone: string;
  timezone: string;
  gstin: string;
};

type ClientResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type ClientFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<ClientResponse>;

type GoogleAuthenticationRequest =
  | { mode: 'signin' }
  | { mode: 'signup'; signup: GoogleSignupFields };

type GoogleAuthenticationDependencies = {
  fetcher: ClientFetcher;
  googleSignIn: (provider: 'google') => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function loadGoogleProviderAvailability(
  fetcher: ClientFetcher,
): Promise<boolean> {
  try {
    const response = await fetcher('/api/auth/providers');
    if (!response.ok) return false;

    const providers = await response.json();
    return isRecord(providers) && isRecord(providers.google);
  } catch {
    return false;
  }
}

export async function beginGoogleAuthentication(
  request: GoogleAuthenticationRequest,
  dependencies: GoogleAuthenticationDependencies,
): Promise<void> {
  if (request.mode === 'signup') {
    const response = await dependencies.fetcher('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'google', ...request.signup }),
    });

    if (!response.ok) {
      let message = 'Unable to start Google sign up.';
      try {
        const data = await response.json();
        if (isRecord(data) && typeof data.error === 'string') {
          message = data.error;
        }
      } catch {
        // Keep the safe fallback when the server does not return JSON.
      }
      throw new Error(message);
    }
  }

  await dependencies.googleSignIn('google');
}
