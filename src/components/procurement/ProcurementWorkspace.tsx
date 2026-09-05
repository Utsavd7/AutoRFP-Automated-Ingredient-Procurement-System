'use client';

import { ArrowRight, CalendarDays, ClipboardList, PackageCheck, Plus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { workspaceFetch } from '@/lib/client/workspace-prefetch';
import { formatIndiaDate as shortDate, formatIndiaDeadline as deadlineText } from '@/lib/domain/india-date';
import styles from './procurement-workspace.module.css';

type RequestStatus = 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';

type ProcurementRequestSummary = {
  id: string;
  title: string;
  status: RequestStatus;
  version: number;
  deliveryDate: string;
  quoteDeadline: string;
  openedAt: string | null;
  awardedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  supplierCount: number;
};

const statusLabel: Record<RequestStatus, string> = {
  DRAFT: 'Not sent',
  OPEN: 'Waiting for suppliers',
  AWARDED: 'Supplier selected',
  CANCELLED: 'Cancelled',
};

async function responseMessage(response: Response, fallback: string) {
  const problem = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
  return problem.detail || problem.error || fallback;
}

export function ProcurementWorkspace({
  initialRequests,
  initialError,
  initialNextCursor = null,
}: {
  initialRequests?: ProcurementRequestSummary[];
  initialError?: string;
  initialNextCursor?: string | null;
}) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests ?? []);
  const [filter, setFilter] = useState<RequestStatus | 'ALL'>('ALL');
  const [loading, setLoading] = useState(initialRequests === undefined);
  const [error, setError] = useState(initialError ?? '');
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const initialLoadStarted = useRef(false);

  const loadRequests = useCallback(async (cursor?: string, usePrefetch = false) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const response = await (usePrefetch
        ? workspaceFetch('/api/requests?limit=50', { cache: 'no-store' })
        : fetch(`/api/requests?${params}`, { cache: 'no-store' }));
      if (!response.ok) throw new Error(await responseMessage(response, 'We could not load procurement requests.'));
      const result = (await response.json()) as { requests?: ProcurementRequestSummary[]; nextCursor?: string | null };
      const loaded = result.requests ?? [];
      setRequests((current) => cursor
        ? [...new Map([...current, ...loaded].map((request) => [request.id, request])).values()]
        : loaded);
      setNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load procurement requests.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (initialRequests !== undefined || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadRequests(undefined, true);
  }, [initialRequests, loadRequests]);

  const shown = filter === 'ALL' ? requests : requests.filter(({ status }) => status === filter);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Restaurant buying</p>
          <h1>Buy ingredients</h1>
          <p className={styles.intro}>
            Ask suppliers for prices, compare the final cost, and record who you choose.
          </p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => router.push('/procurement/new')}>
          <Plus aria-hidden="true" /> Ask suppliers for prices
        </button>
      </header>

      <section className={styles.summary} aria-label="Request summary">
        <div><ClipboardList aria-hidden="true" /><span><strong>{requests.filter(({ status }) => status === 'DRAFT').length}</strong>Not sent</span></div>
        <div><Users aria-hidden="true" /><span><strong>{requests.filter(({ status }) => status === 'OPEN').length}</strong>Waiting for suppliers</span></div>
        <div><PackageCheck aria-hidden="true" /><span><strong>{requests.filter(({ status }) => status === 'AWARDED').length}</strong>Supplier selected</span></div>
      </section>

      <nav className={styles.filters} aria-label="Filter requests">
        {(['ALL', 'DRAFT', 'OPEN', 'AWARDED', 'CANCELLED'] as const).map((status) => (
          <button className={filter === status ? styles.selectedFilter : ''} type="button" key={status} onClick={() => setFilter(status)}>
            {status === 'ALL' ? 'All requests' : statusLabel[status]}
          </button>
        ))}
      </nav>

      {error && (
        <div className={styles.error} role="alert"><span>{error} Your saved restaurant records are unchanged.</span><button type="button" onClick={() => void loadRequests()}>Try again</button></div>
      )}

      {loading ? (
        <section className={styles.loading} aria-label="Loading requests"><span /><span /><span /></section>
      ) : error && requests.length === 0 ? null : shown.length === 0 && requests.length === 0 ? (
        <section className={styles.empty}>
          <div className={styles.emptyMark}><ClipboardList aria-hidden="true" /></div>
          <p className={styles.eyebrow}>Ready when you are</p>
          <h2>Create your first request</h2>
          <p>Start with an approved menu and at least one supplier. You can review everything before sharing any link.</p>
          <button className={styles.primaryButton} type="button" onClick={() => router.push('/procurement/new')}>
            <Plus aria-hidden="true" /> Ask suppliers for prices
          </button>
        </section>
      ) : shown.length === 0 ? (
        <section className={styles.filteredEmpty}>No requests match this filter.</section>
      ) : (
        <section className={styles.requestList} aria-label="Procurement requests">
          <div className={styles.listHeader}>
            <span>Request</span><span>Coverage</span><span>Quote deadline</span><span>Delivery</span><span>Status</span><span />
          </div>
          {shown.map((request) => (
            <button className={styles.requestRow} type="button" key={request.id} onClick={() => router.push(`/procurement/${encodeURIComponent(request.id)}`)}>
              <span className={styles.requestName}>
                <strong>{request.title}</strong>
                <small>Created {shortDate(request.createdAt)}</small>
              </span>
              <span className={styles.coverage}>
                <span>{request.itemCount} {request.itemCount === 1 ? 'item' : 'items'}</span>
                <span>{request.supplierCount} {request.supplierCount === 1 ? 'supplier' : 'suppliers'}</span>
              </span>
              <span className={styles.date}><small className={styles.mobileLabel}>Quote by</small><CalendarDays aria-hidden="true" />{deadlineText(request.quoteDeadline)}</span>
              <span className={styles.date}><small className={styles.mobileLabel}>Delivery</small>{shortDate(request.deliveryDate)}</span>
              <span><i className={styles[`status${request.status}`]}>{statusLabel[request.status]}</i></span>
              <ArrowRight className={styles.arrow} aria-hidden="true" />
            </button>
          ))}
        </section>
      )}

      {nextCursor && !loading && (
        <button
          className={styles.loadMore}
          type="button"
          disabled={loadingMore}
          onClick={() => void loadRequests(nextCursor)}
        >
          {loadingMore ? 'Loading more…' : 'Load more requests'}
        </button>
      )}
    </main>
  );
}
