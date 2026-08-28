import NextAuth from 'next-auth';

import {
  createRequestAuthOptions,
  expiredGoogleOnboardingHeader,
  shouldClearGoogleOnboarding,
} from '@/lib/auth/request-options';

async function handler(request: Request, context: unknown) {
  const response = await NextAuth(createRequestAuthOptions(request))(
    request,
    context,
  );
  if (shouldClearGoogleOnboarding(request)) {
    response.headers.append(
      'Set-Cookie',
      expiredGoogleOnboardingHeader(process.env.NODE_ENV === 'production'),
    );
  }
  return response;
}

export { handler as GET, handler as POST };
