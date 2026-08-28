import type { Metadata } from 'next';
import Link from 'next/link';

import { Wordmark } from '@/components/brand/Wordmark';

import { QuoteAccessClient } from './QuoteAccessClient';
import styles from './quote-access.module.css';

export const metadata: Metadata = {
  title: 'Supplier quote',
  description: 'Open a secure QuotePlate supplier request.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SupplierQuoteAccessPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/" aria-label="QuotePlate home">
          <Wordmark />
        </Link>
        <QuoteAccessClient />
        <p className={styles.footer}>
          The restaurant that sent this link controls the request and can issue a new link if needed.
        </p>
      </div>
    </main>
  );
}
