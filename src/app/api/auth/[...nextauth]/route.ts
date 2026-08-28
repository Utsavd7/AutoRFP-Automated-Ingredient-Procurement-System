import NextAuth from 'next-auth';

import {
  createRequestAuthOptions,
  googleOnboardingHeaders,
} from '@/lib/auth/request-options';

async function handler(request: Request, context: unknown) {
  const onboardingRequest = request.clone();
  const response = await NextAuth(createRequestAuthOptions(request))(
    request,
    context,
  );
  for (const header of await googleOnboardingHeaders(
    onboardingRequest,
    response,
  )) {
    response.headers.append('Set-Cookie', header);
  }
  return response;
}

export { handler as GET, handler as POST };
