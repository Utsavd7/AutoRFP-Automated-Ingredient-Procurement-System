'use client';

import { useEffect, useRef, useState } from 'react';

import { SupplierApplicationForm } from './SupplierApplicationForm';
import styles from './supplier-application.module.css';

type LinkState =
  | { status: 'checking' }
  | { status: 'ready'; token: string }
  | { status: 'invalid' };

export function rememberFragmentToken(current: string, hash: string) {
  const params = new URLSearchParams(hash.slice(1));
  return params.get('token') || current;
}

export function SupplierApplicationAccess() {
  const tokenRef = useRef('');
  const [link, setLink] = useState<LinkState>({ status: 'checking' });

  useEffect(() => {
    const token = rememberFragmentToken(tokenRef.current, window.location.hash);
    tokenRef.current = token;
    window.history.replaceState(null, '', '/supplier-application');
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setLink(token ? { status: 'ready', token } : { status: 'invalid' });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (link.status === 'ready') {
    return <SupplierApplicationForm token={link.token} />;
  }

  return (
    <section className={styles.linkState} aria-labelledby="supplier-link-heading">
      <p className={styles.eyebrow}>Supplier application</p>
      <h1 id="supplier-link-heading">
        {link.status === 'checking' ? 'Opening your application.' : 'This link is unavailable.'}
      </h1>
      <div className={styles.linkMessage} role="status" aria-live="polite">
        <span className={link.status === 'checking' ? styles.spinner : styles.stopMark} aria-hidden="true" />
        <p>
          {link.status === 'checking'
            ? 'This takes only a moment.'
            : 'Ask the restaurant to send you a new supplier application link.'}
        </p>
      </div>
    </section>
  );
}
