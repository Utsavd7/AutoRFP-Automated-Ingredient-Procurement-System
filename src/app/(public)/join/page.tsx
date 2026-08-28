import type { Metadata } from 'next';
import Link from 'next/link';

import { Wordmark } from '@/components/brand/Wordmark';

import { JoinInvitationForm } from './JoinInvitationForm';
import styles from './join.module.css';

export const metadata: Metadata = {
  title: 'Join workspace',
  description: 'Accept a QuotePlate workspace invitation.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function JoinInvitationPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/" aria-label="QuotePlate home">
          <Wordmark />
        </Link>
        <section className={styles.card} aria-labelledby="join-heading">
          <p className={styles.eyebrow}>Workspace invitation</p>
          <h1 id="join-heading">Join your restaurant workspace</h1>
          <p className={styles.intro}>
            Confirm the invited email, then create your secure account. This link can be used once and expires after seven days.
          </p>
          <JoinInvitationForm />
        </section>
        <p className={styles.footer}>
          The restaurant that invited you controls workspace access. QuotePlate never emails or charges suppliers to join.
        </p>
      </div>
    </main>
  );
}
