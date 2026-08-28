import {
  createAuthOptions,
  type AuthEnvironment,
} from '@/lib/auth';
import type { GoogleIdentityRepository } from '@/lib/auth/google-identity';
import {
  createGoogleOnboardingOAuthCookie,
  expiredGoogleOnboardingCookie,
  googleOnboardingCookieHeader,
  googleOnboardingOAuthCookieName,
  googleOnboardingPendingCookieName,
  readGoogleOnboardingCookie,
} from '@/lib/auth/oauth-start';
import { authClientIdentifier } from '@/lib/auth/rate-limit';
import {
  GOOGLE_SIGNUP_FLOW_FIELD,
  validGoogleSignupFlowId,
} from '@/lib/auth/google-flow';

function cookieValue(request: Request, name: string) {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
}

export function createRequestAuthOptions(
  request: Request,
  input: {
    env?: AuthEnvironment;
    now?: Date;
    googleIdentityRepository?: GoogleIdentityRepository;
  } = {},
) {
  const env = input.env ?? process.env;
  const secret = env.NEXTAUTH_SECRET?.trim();
  const callbackState = shouldClearGoogleOnboarding(request)
    ? new URL(request.url).searchParams.get('state')
    : null;
  const callbackCookieName = googleOnboardingOAuthCookieName(callbackState);
  const googleOnboarding = secret && callbackCookieName
    ? readGoogleOnboardingCookie(
        cookieValue(request, callbackCookieName),
        { secret, now: input.now },
      )
    : null;

  return createAuthOptions({
    env,
    credentialsClientIdentifier: authClientIdentifier(request.headers),
    googleOnboarding,
    googleIdentityRepository: input.googleIdentityRepository,
  });
}

export function shouldClearGoogleOnboarding(request: Request) {
  return new URL(request.url).pathname.endsWith('/api/auth/callback/google');
}

async function signupFlowFromRequest(request: Request) {
  if (
    request.method !== 'POST' ||
    !new URL(request.url).pathname.endsWith('/api/auth/signin/google')
  ) {
    return null;
  }
  try {
    const fields = new URLSearchParams(await request.text());
    const flowId = fields.get(GOOGLE_SIGNUP_FLOW_FIELD);
    return validGoogleSignupFlowId(flowId) ? flowId : null;
  } catch {
    return null;
  }
}

async function oauthStateFromResponse(response: Response) {
  try {
    const data = await response.clone().json() as { url?: unknown };
    if (typeof data.url !== 'string') return null;
    return new URL(data.url).searchParams.get('state');
  } catch {
    return null;
  }
}

export async function googleOnboardingHeaders(
  request: Request,
  response: Response,
  input: { env?: AuthEnvironment; now?: Date } = {},
) {
  const env = input.env ?? process.env;
  const secret = env.NEXTAUTH_SECRET?.trim();
  if (!secret) return [];
  const secure = env.NODE_ENV === 'production';

  const flowId = await signupFlowFromRequest(request);
  if (flowId) {
    const pendingName = googleOnboardingPendingCookieName(flowId);
    const pendingValue = pendingName
      ? cookieValue(request, pendingName)
      : null;
    const state = await oauthStateFromResponse(response);
    const oauthCookie = pendingValue && state
      ? createGoogleOnboardingOAuthCookie(pendingValue, state, {
          secret,
          now: input.now,
          secure,
          expectedFlowId: flowId,
        })
      : null;
    if (!oauthCookie || !pendingName) return [];

    return [
      googleOnboardingCookieHeader(oauthCookie),
      googleOnboardingCookieHeader(
        expiredGoogleOnboardingCookie(pendingName, '/api/auth', secure),
      ),
    ];
  }

  if (shouldClearGoogleOnboarding(request)) {
    const state = new URL(request.url).searchParams.get('state');
    const cookieName = googleOnboardingOAuthCookieName(state);
    if (cookieName) {
      return [
        googleOnboardingCookieHeader(
          expiredGoogleOnboardingCookie(
            cookieName,
            '/api/auth/callback/google',
            secure,
          ),
        ),
      ];
    }
  }

  return [];
}
