import type { Metadata } from 'next';

import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { googleAuthAvailable } from '@/lib/auth';
import { resolveAuthCallback } from '@/lib/auth/callback-url';
import { authErrorMessage } from '@/lib/auth/client-errors';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your QuotePlate restaurant procurement workspace.',
  robots: { index: false, follow: false },
};

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const callbackUrl = resolveAuthCallback(params.callbackUrl);
  const error = one(params.error);
  const googleAvailable =
    googleAuthAvailable(process.env) && Boolean(process.env.NEXTAUTH_SECRET?.trim());

  return (
    <AuthPageShell
      mode="signin"
      callbackUrl={callbackUrl}
      googleAvailable={googleAvailable}
      initialError={error ? authErrorMessage(error) : null}
    />
  );
}
