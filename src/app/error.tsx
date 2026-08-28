'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import styles from './error.module.css';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error(error);
  }, [error]);

  return (
    <main className={`${styles.page} ${styles.rootPage}`}>
      <section className={styles.panel} role="alert">
        <div className={styles.icon}><AlertTriangle aria-hidden="true" /></div>
        <p className={styles.eyebrow}>QuotePlate recovery</p>
        <h1>We could not open this page.</h1>
        <p className={styles.description}>
          Your saved restaurant records are unchanged. Try the page again; if the problem continues, return after a short wait.
        </p>
        <button onClick={reset} className={styles.button} type="button">
          <RotateCcw aria-hidden="true" />
          Try again
        </button>
      </section>
    </main>
  );
}
