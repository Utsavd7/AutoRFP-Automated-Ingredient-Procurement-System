'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import styles from '../error.module.css';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error(error);
  }, [error]);

  return (
    <main className={styles.page}>
      <section className={styles.panel} role="alert">
        <div className={styles.icon}><AlertTriangle aria-hidden="true" /></div>
        <p className={styles.eyebrow}>Workspace recovery</p>
        <h1>This view could not load.</h1>
        <p className={styles.description}>
          Your saved requests, quotes, and award records are unchanged. Retry this view or use the workspace navigation to continue elsewhere.
        </p>
        <button onClick={reset} className={styles.button} type="button">
          <RotateCcw aria-hidden="true" />
          Retry
        </button>
      </section>
    </main>
  );
}
