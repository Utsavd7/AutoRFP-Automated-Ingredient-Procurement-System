import { useEffect, useRef, useState } from 'react';

import { supplierSearchDocument, SUPPLIER_SEARCH_SANDBOX, SUPPLIER_SEARCH_TIMEOUT_MS } from '@/lib/suppliers/google-search-element';

import styles from './supplier-discovery.module.css';

export function GoogleSupplierSearch({ engineId, query }: { engineId: string; query: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const document = supplierSearchDocument(engineId, query);

  useEffect(() => {
    const timeout = window.setTimeout(() => setStatus('failed'), SUPPLIER_SEARCH_TIMEOUT_MS + 1000);
    function receive(event: MessageEvent) {
      // The sandbox has an opaque origin; accept only status messages from this frame.
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null' || event.data?.type !== 'quoteplate-supplier-search') return;
      if (event.data.status === 'ready' || event.data.status === 'failed') {
        clearTimeout(timeout);
        setStatus(event.data.status);
      }
    }
    window.addEventListener('message', receive);
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
  }, []);

  return <section className={styles.combined} aria-label="Combined supplier search">
    <h3>Search across supplier websites</h3>
    <p className={styles.help}>Results and ads are provided by Google from the configured supplier websites. Listings are not verified by QuotePlate; open a result to review it before adding a supplier.</p>
    {status === 'loading' && document && <p role="status" className={styles.help}>Loading Google search results…</p>}
    {status === 'failed' || !document
      ? <p role="status" className={styles.error}>Combined search is unavailable right now. Use the individual website searches below.</p>
      : <iframe ref={frame} title="Google supplier search results and ads" sandbox={SUPPLIER_SEARCH_SANDBOX} referrerPolicy="no-referrer" srcDoc={document} className={styles.searchFrame} />}
  </section>;
}
