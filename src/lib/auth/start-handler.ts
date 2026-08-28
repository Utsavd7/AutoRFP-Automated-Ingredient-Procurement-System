import { NextResponse } from 'next/server';

import {
  googleAuthAvailable,
  type AuthEnvironment,
} from '@/lib/auth';
import {
  createEmailWorkspace,
  EmailSignupError,
  type EmailSignupInput,
} from '@/lib/auth/email-signup';
import {
  createGoogleOnboardingCookie,
  GoogleOnboardingError,
} from '@/lib/auth/oauth-start';

type AuthStartDependencies = {
  env: AuthEnvironment;
  emailSignup: typeof createEmailWorkspace;
  now: () => Date;
};

function errorResponse(error: unknown) {
  if (error instanceof EmailSignupError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof GoogleOnboardingError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(
    { error: 'Unable to create the workspace right now. Try again shortly.' },
    { status: 503 },
  );
}

export function createAuthStartHandler(dependencies: AuthStartDependencies) {
  return async function authStart(request: Request) {
    let body: EmailSignupInput & { method?: string };
    try {
      body = (await request.json()) as EmailSignupInput & { method?: string };
    } catch {
      return NextResponse.json(
        { error: 'Send valid signup details.' },
        { status: 400 },
      );
    }

    if (body.method !== 'email' && body.method !== 'google') {
      return NextResponse.json(
        { error: 'Choose email or Google signup.' },
        { status: 400 },
      );
    }

    if (body.method === 'email') {
      try {
        await dependencies.emailSignup(body);
        return NextResponse.json({ ok: true }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (!googleAuthAvailable(dependencies.env)) {
      return NextResponse.json(
        { error: 'Google sign-in is not configured. Use email and password.' },
        { status: 503 },
      );
    }
    const secret = dependencies.env.NEXTAUTH_SECRET?.trim();
    if (!secret) {
      return NextResponse.json(
        { error: 'Google sign-in is temporarily unavailable. Use email and password.' },
        { status: 503 },
      );
    }

    try {
      const cookie = createGoogleOnboardingCookie(
        {
          restaurantName: body.restaurantName ?? '',
          ownerName: body.ownerName ?? '',
          email: body.email ?? '',
          addressLine: body.addressLine ?? '',
          city: body.city ?? '',
          state: body.state ?? '',
          pin: body.pin ?? '',
          phone: body.phone ?? '',
          timezone: body.timezone,
          gstin: body.gstin,
        },
        {
          secret,
          now: dependencies.now(),
          secure: dependencies.env.NODE_ENV === 'production',
        },
      );
      const response = NextResponse.json({ ok: true, provider: 'google' });
      response.cookies.set(cookie.name, cookie.value, cookie.options);
      return response;
    } catch (error) {
      return errorResponse(error);
    }
  };
}
