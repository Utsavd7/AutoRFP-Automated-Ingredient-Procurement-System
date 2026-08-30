import {
  GOOGLE_SIGNUP_FLOW_FIELD,
  validGoogleSignupFlowId,
} from '@/lib/auth/google-flow';

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
  | { mode: 'signin'; callbackUrl: string }
  | { mode: 'signup'; signup: GoogleSignupFields; callbackUrl: string };

type GoogleAuthenticationDependencies = {
  fetcher: ClientFetcher;
  googleSignIn: (
    provider: 'google',
    options: { callbackUrl: string; autorfpSignupFlow?: string },
  ) => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function beginGoogleAuthentication(
  request: GoogleAuthenticationRequest,
  dependencies: GoogleAuthenticationDependencies,
): Promise<void> {
  let signupFlowId: string | null = null;
  if (request.mode === 'signup') {
    const response = await dependencies.fetcher('/api/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'google', ...request.signup }),
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // The stable fallback below covers malformed server responses.
    }
    if (!response.ok) {
      throw new Error(
        isRecord(data) && typeof data.error === 'string'
          ? data.error
          : 'Unable to start Google sign up.',
      );
    }
    const flowId = isRecord(data) ? data.flowId : null;
    if (!validGoogleSignupFlowId(flowId)) {
      throw new Error('Unable to start Google sign up.');
    }
    signupFlowId = flowId;
  }

  await dependencies.googleSignIn('google', {
    callbackUrl: request.callbackUrl,
    ...(signupFlowId
      ? { [GOOGLE_SIGNUP_FLOW_FIELD]: signupFlowId }
      : {}),
  });
}
