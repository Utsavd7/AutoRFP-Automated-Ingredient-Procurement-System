'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';

import styles from './join.module.css';

export function JoinInvitationForm() {
  const tokenRef = useRef('');
  const [linkReady, setLinkReady] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = params.get('token') ?? '';
    window.history.replaceState(null, '', '/join');
    tokenRef.current = fragmentToken;
    setLinkReady(true);
    if (!fragmentToken) {
      setError('This invitation link is incomplete. Ask your restaurant to send it again.');
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = tokenRef.current;
    if (!token) return;
    setError('');
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');

    try {
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          name: String(form.get('name') ?? ''),
          email,
          password,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { detail?: string }
        | null;
      if (!response.ok) {
        setError(body?.detail ?? 'Unable to accept this invitation.');
        return;
      }

      tokenRef.current = '';
      setAccepted(true);
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl: '/dashboard',
      });
      if (result?.ok) {
        window.location.assign(result.url || '/dashboard');
        return;
      }
      setError(
        'Your workspace account is ready. Sign in with the email and password you just chose.',
      );
    } catch {
      setError('Unable to accept this invitation. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = !linkReady || !tokenRef.current || submitting || accepted;

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={submitting}>
      <div className={styles.field}>
        <label htmlFor="join-name">Full name</label>
        <input
          id="join-name"
          name="name"
          type="text"
          autoComplete="name"
          maxLength={200}
          required
          disabled={disabled || accepted}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="join-email">Invited email</label>
        <input
          id="join-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={320}
          required
          aria-describedby="join-email-help"
          disabled={disabled || accepted}
        />
        <p id="join-email-help" className={styles.help}>
          Use the exact email address this invitation was created for.
        </p>
      </div>
      <div className={styles.field}>
        <label htmlFor="join-password">Create password</label>
        <input
          id="join-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={1024}
          required
          disabled={disabled || accepted}
        />
      </div>

      <div className={styles.message} role="status" aria-live="polite">
        {error}
      </div>
      <button className={styles.submit} type="submit" disabled={disabled}>
        {!linkReady
          ? 'Checking invitation…'
          : submitting
            ? 'Joining workspace…'
            : accepted
              ? 'Invitation accepted'
              : 'Accept invitation'}
      </button>
      {accepted && error ? (
        <a className={styles.signInLink} href="/signin">
          Continue to sign in
        </a>
      ) : null}
    </form>
  );
}
