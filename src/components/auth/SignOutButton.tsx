'use client';

import { LogOut } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { setWorkspacePrefetchScope } from '@/lib/client/workspace-prefetch';

type SignOutButtonProps = {
  className?: string;
};

const SIGN_OUT_ERROR = 'Sign out could not be completed. Your session is still active. Try again.';

export function SignOutButton({ className = '' }: SignOutButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  async function handleSignOut() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      setWorkspacePrefetchScope(null);
      await signOut({ callbackUrl: '/signin', redirect: false });
      const account = await fetch('/api/account', { cache: 'no-store' });
      if (account.status !== 401) throw new Error('Session is still active');
      router.replace('/signin');
      router.refresh();
    } catch {
      setError(SIGN_OUT_ERROR);
      setPending(false);
    }
  }

  return (
    <>
      <button
        aria-describedby={error ? errorId : undefined}
        className={className}
        disabled={pending}
        onClick={handleSignOut}
        type="button"
      >
        <LogOut aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
        <span aria-live="polite">{pending ? 'Signing out…' : 'Sign out'}</span>
      </button>
      {error && (
        <p className="px-3 pt-1 text-[11px] leading-4 text-red-300" id={errorId} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
