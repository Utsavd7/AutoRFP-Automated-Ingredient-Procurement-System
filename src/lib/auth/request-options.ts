import {
  createAuthOptions,
  type AuthEnvironment,
} from '@/lib/auth';
import type { GoogleIdentityRepository } from '@/lib/auth/google-identity';
import {
  GOOGLE_ONBOARDING_COOKIE,
  expiredGoogleOnboardingCookie,
  readGoogleOnboardingCookie,
} from '@/lib/auth/oauth-start';

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
  const googleOnboarding = secret
    ? readGoogleOnboardingCookie(
        cookieValue(request, GOOGLE_ONBOARDING_COOKIE),
        { secret, now: input.now },
      )
    : null;

  return createAuthOptions({
    env,
    googleOnboarding,
    googleIdentityRepository: input.googleIdentityRepository,
  });
}

export function shouldClearGoogleOnboarding(request: Request) {
  return new URL(request.url).pathname.endsWith('/api/auth/callback/google');
}

export function expiredGoogleOnboardingHeader(secure: boolean) {
  const cookie = expiredGoogleOnboardingCookie(secure);
  return `${cookie.name}=; Path=${cookie.options.path}; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
