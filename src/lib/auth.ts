import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';

import {
  authenticateCredentials,
  type CredentialsRepository,
} from '@/lib/auth/credentials';
import {
  resolveGoogleIdentity,
  type GoogleIdentityRepository,
  type GoogleIdentityUser,
} from '@/lib/auth/google-identity';
import type { GoogleOnboarding } from '@/lib/auth/oauth-start';

export type AuthEnvironment = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  NEXTAUTH_SECRET?: string;
  NODE_ENV?: string;
};

type AuthOptionsInput = {
  env?: AuthEnvironment;
  googleOnboarding?: GoogleOnboarding | null;
  credentialsRepository?: CredentialsRepository;
  googleIdentityRepository?: GoogleIdentityRepository;
};

export function googleAuthAvailable(env: AuthEnvironment = process.env) {
  return Boolean(
    env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

export function createAuthOptions(
  input: AuthOptionsInput = {},
): NextAuthOptions {
  const env = input.env ?? process.env;
  const providers: NextAuthOptions['providers'] = [
    CredentialsProvider({
      name: 'Email and password',
      credentials: {
        email: { label: 'Work email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        return authenticateCredentials(
          {
            email: credentials?.email,
            password: credentials?.password,
          },
          input.credentialsRepository,
        );
      },
    }),
  ];

  if (googleAuthAvailable(env)) {
    providers.push(
      GoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID!.trim(),
        clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
        authorization: { params: { scope: 'openid email profile' } },
      }),
    );
  }

  let requestGoogleIdentity: GoogleIdentityUser | null = null;

  return {
    secret: env.NEXTAUTH_SECRET,
    session: { strategy: 'jwt' },
    providers,
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== 'google') return true;

        requestGoogleIdentity = await resolveGoogleIdentity(
          {
            account: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
            profile: profile ?? {},
            onboarding: input.googleOnboarding ?? null,
          },
          input.googleIdentityRepository,
        );
        return true;
      },

      async jwt({ token, user, account }) {
        if (account?.provider === 'google') {
          return requestGoogleIdentity
            ? {
                userId: requestGoogleIdentity.userId,
                tenantId: requestGoogleIdentity.tenantId,
              }
            : {};
        }

        const stableUser = user as
          | (typeof user & { userId?: string; tenantId?: string })
          | undefined;
        const userId = stableUser?.userId ?? token.userId;
        const tenantId = stableUser?.tenantId ?? token.tenantId;
        return userId && tenantId ? { userId, tenantId } : {};
      },

      async session({ session, token }) {
        session.user =
          token.userId && token.tenantId
            ? { userId: token.userId, tenantId: token.tenantId }
            : undefined;
        return session;
      },
    },
  };
}

// Server-side session reads do not execute an OAuth callback. The callback route
// creates a fresh options object per request so Google callback state stays local.
export const authOptions = createAuthOptions();
