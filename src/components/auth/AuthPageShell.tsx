import Link from 'next/link';

import { Wordmark } from '@/components/brand/Wordmark';
import { brand } from '@/config/brand';

import { AuthForm } from './AuthForm';
import styles from './AuthExperience.module.css';

type AuthPageShellProps = {
  mode: 'signin' | 'start';
  googleAvailable: boolean;
  emailOwnerSignupAvailable?: boolean;
  callbackUrl: string;
  initialError?: string | null;
};

const content = {
  signin: {
    eyebrow: 'Restaurant workspace',
    title: 'Return to the decisions that need you.',
    description:
      'Open current requests, compare supplier terms, and keep every award tied to the quote that earned it.',
    document: 'Account access',
    note: 'Restaurant records remain on the server; your browser stores only the session needed to keep you signed in.',
  },
  start: {
    eyebrow: 'India pilot',
    title: 'Set up the workspace behind your next purchase.',
    description:
      'Create one secure restaurant workspace for your team, suppliers, requests, and award history.',
    document: 'Owner registration',
    note: 'Starting the pilot does not activate a paid plan or automatic billing.',
  },
} as const;

export function AuthPageShell(props: AuthPageShellProps) {
  const page = content[props.mode];

  return (
    <main className={styles.page} id="main-content">
      <a className={styles.skipLink} href="#account-form">
        Skip to account form
      </a>

      <header className={styles.header}>
        <Link className={styles.homeLink} href="/" aria-label={`${brand.productName} home`}>
          <Wordmark />
        </Link>
        <Link className={styles.headerLink} href={props.mode === 'signin' ? '/start' : '/signin'}>
          {props.mode === 'signin' ? 'Create a workspace' : 'I already have an account'}
        </Link>
      </header>

      <div className={styles.layout}>
        <aside className={styles.context} aria-labelledby="account-heading">
          <p className={styles.eyebrow}>{page.eyebrow}</p>
          <h1 id="account-heading">{page.title}</h1>
          <p className={styles.introduction}>{page.description}</p>

          <dl className={styles.assurances}>
            <div>
              <dt>01</dt>
              <dd>One workspace, isolated from every other restaurant.</dd>
            </div>
            <div>
              <dt>02</dt>
              <dd>Google stores identity only; QuotePlate stores no Google access tokens.</dd>
            </div>
            <div>
              <dt>03</dt>
              <dd>A human reviews and records every supplier award.</dd>
            </div>
          </dl>

          <p className={styles.contextNote}>{page.note}</p>
        </aside>

        <section
          className={styles.sheet}
          id="account-form"
          tabIndex={-1}
          aria-label={page.document}
        >
          <div className={styles.sheetHeader}>
            <div>
              <span>QuotePlate / {page.document}</span>
              <strong>{props.mode === 'signin' ? 'Existing user' : 'Workspace owner'}</strong>
            </div>
            <span aria-hidden="true">IN · 01</span>
          </div>
          {props.mode === 'start' && (
            <aside className={styles.pilotNotice} aria-label="Controlled pilot terms">
              <strong>Controlled pilot terms</strong>
              <ul>
                <li>Up to four approved restaurant workspaces</li>
                <li>Use the Google account approved for your workspace</li>
                <li>No payment card. No billing.</li>
              </ul>
            </aside>
          )}
          <AuthForm {...props} />
        </section>
      </div>

      <footer className={styles.footer}>
        <span>{brand.companyName}</span>
        <nav aria-label="Account page legal links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </main>
  );
}
