import type { Metadata } from 'next';
import Link from 'next/link';

import { Wordmark } from '@/components/brand/Wordmark';

import { SupplierApplicationAccess } from './SupplierApplicationAccess';
import styles from './supplier-application.module.css';

export const metadata: Metadata = {
  title: 'Supplier application',
  description: 'Apply to supply a restaurant through QuotePlate.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SupplierApplicationPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/" aria-label="QuotePlate home">
          <Wordmark />
        </Link>
        <div className={styles.paper}>
          <div className={styles.rule} aria-hidden="true" />
          <SupplierApplicationAccess />
        </div>
        <p className={styles.pageFooter}>
          Your details are shared only with the restaurant that sent this link.
        </p>
      </div>
    </main>
  );
}
