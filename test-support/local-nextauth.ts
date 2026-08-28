import NextAuth from 'next-auth';
import type { OAuthConfig } from 'next-auth/providers/oauth';

import {
  createRequestAuthOptions,
  googleOnboardingHeaders,
} from '@/lib/auth/request-options';

type LocalGoogleProfile = {
  sub: string;
  name: string;
  email: string;
  email_verified: boolean;
  picture: string | null;
};

function localGoogleProvider(origin: string): OAuthConfig<LocalGoogleProfile> {
  return {
    id: 'google',
    name: 'Local Google test provider',
    type: 'oauth',
    authorization: `${origin}/__test/oauth/authorize`,
    token: `${origin}/__test/oauth/token`,
    userinfo: `${origin}/__test/oauth/userinfo`,
    clientId: 'local-google-client',
    clientSecret: 'local-google-secret',
    checks: ['state'],
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        image: profile.picture,
      };
    },
  };
}

export async function handleLocalNextAuth(request: Request) {
  const onboardingRequest = request.clone();
  const origin = new URL(request.url).origin;
  const options = createRequestAuthOptions(request, {
    env: {
      ...process.env,
      GOOGLE_CLIENT_ID: 'local-google-client',
      GOOGLE_CLIENT_SECRET: 'local-google-secret',
    },
  });
  options.providers = options.providers.map((provider) =>
    provider.id === 'google' ? localGoogleProvider(origin) : provider,
  );

  const url = new URL(request.url);
  const nextauth = url.pathname.slice('/api/auth/'.length).split('/');
  const query = Object.fromEntries(url.searchParams);
  const cookies = Object.fromEntries(
    (request.headers.get('cookie') ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
  const contentType = request.headers.get('content-type') ?? '';
  const rawBody = request.method === 'GET' ? '' : await request.text();
  const body = contentType.includes('application/json')
    ? JSON.parse(rawBody || '{}')
    : Object.fromEntries(new URLSearchParams(rawBody));

  let status = 200;
  let responseBody: BodyInit | null = null;
  const responseHeaders = new Map<string, string[]>();
  const response = {
    status(code: number) {
      status = code;
      return response;
    },
    getHeader(name: string) {
      const values = responseHeaders.get(name.toLowerCase());
      return values && (values.length === 1 ? values[0] : values);
    },
    setHeader(name: string, value: string | string[]) {
      responseHeaders.set(
        name.toLowerCase(),
        Array.isArray(value) ? value.map(String) : [String(value)],
      );
      return response;
    },
    json(value: unknown) {
      response.setHeader('content-type', 'application/json');
      responseBody = JSON.stringify(value);
      return response;
    },
    send(value: unknown) {
      if (value !== null && typeof value === 'object') {
        return response.json(value);
      }
      responseBody = value == null ? null : String(value);
      return response;
    },
    end(value?: unknown) {
      if (value !== undefined) responseBody = String(value);
      return response;
    },
  };

  await NextAuth(options)(
    {
      body,
      cookies,
      headers: Object.fromEntries(request.headers),
      method: request.method,
      query: { ...query, nextauth },
    } as never,
    response as never,
  );

  const headers = new Headers();
  for (const [name, values] of responseHeaders) {
    for (const value of values) headers.append(name, value);
  }
  const webResponse = new Response(responseBody, { status, headers });
  for (const header of await googleOnboardingHeaders(
    onboardingRequest,
    webResponse,
  )) {
    webResponse.headers.append('set-cookie', header);
  }
  return webResponse;
}
