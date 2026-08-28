'use client';

import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  RefreshCw,
  Send,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { OverviewData as ServiceOverviewData } from '@/lib/overview/overview-service';

import styles from './overview-workspace.module.css';

export type OverviewData = ServiceOverviewData;

function groupIndianDigits(value: string) {
  if (value.length <= 3) return value;
  const lastThree = value.slice(-3);
  const leading = value.slice(0, -3);
  const pairs: string[] = [];
  for (let end = leading.length; end > 0; end -= 2) {
    pairs.unshift(leading.slice(Math.max(0, end - 2), end));
  }
  return `${pairs.join(',')},${lastThree}`;
}

export function formatInrFromPaise(value: string) {
  const digits = /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, '') : '0';
  const padded = digits.padStart(3, '0');
  const rupees = padded.slice(0, -2);
  const paise = padded.slice(-2);
  return `₹${groupIndianDigits(rupees)}.${paise}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function formatAwardDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Award date unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function greeting(value?: string) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Kolkata',
    }).format(safeDate),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function deadlineLabel(deadline: string, generatedAt: string) {
  const remaining = new Date(deadline).getTime() - new Date(generatedAt).getTime();
  if (!Number.isFinite(remaining)) return 'Open';
  if (remaining <= 0) return 'Deadline passed';
  if (remaining <= 24 * 60 * 60 * 1_000) return 'Due within 24 hours';
  return 'Open for quotes';
}

async function responseMessage(response: Response) {
  const value = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
  };
  return value.detail || value.error || 'We could not load your overview.';
}

function OverviewLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Loading your procurement overview">
      <div className={styles.loadingHeader}><span /><span /></div>
      <div className={styles.loadingCards}><span /><span /><span /><span /></div>
      <div className={styles.loadingPanels}><span /><span /></div>
      <p className={styles.srOnly}>Loading your procurement overview</p>
    </main>
  );
}

function OverviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className={styles.page}>
      <section className={styles.errorState} role="alert">
        <span className={styles.errorMark}><RefreshCw aria-hidden="true" /></span>
        <p className={styles.eyebrow}>Overview unavailable</p>
        <h1>We could not load your overview.</h1>
        <p>{message}</p>
        <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" /> Try again</button>
      </section>
    </main>
  );
}

function EmptyWorkspace() {
  return (
    <section className={styles.emptyWorkspace}>
      <span className={styles.emptyMark}><ClipboardList aria-hidden="true" /></span>
      <p className={styles.eyebrow}>Start here</p>
      <h2>Set up your procurement workspace</h2>
      <p>Add the suppliers you already buy from, then review a menu before sending your first request.</p>
      <div className={styles.emptyActions}>
        <Link className={styles.primaryAction} href="/suppliers">Add suppliers <ArrowRight aria-hidden="true" /></Link>
        <Link className={styles.secondaryAction} href="/menus">Add a menu <ArrowRight aria-hidden="true" /></Link>
      </div>
    </section>
  );
}

function hasAnyWork(data: OverviewData) {
  const { counts } = data;
  return (
    counts.activeSuppliers > 0 ||
    counts.menus.draft > 0 ||
    counts.menus.approved > 0 ||
    counts.requests.draft > 0 ||
    counts.requests.open > 0 ||
    counts.requests.awarded > 0
  );
}

export function OverviewWorkspace({
  initialData,
  initialError,
}: {
  initialData?: OverviewData;
  initialError?: string;
}) {
  const [data, setData] = useState<OverviewData | null>(initialData ?? null);
  const [loading, setLoading] = useState(initialData === undefined && initialError === undefined);
  const [error, setError] = useState(initialError ?? '');
  const initialLoadStarted = useRef(false);

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/overview', { cache: 'no-store', signal });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = (await response.json()) as { overview?: OverviewData };
      if (!result.overview) throw new Error('The overview response was incomplete.');
      setData(result.overview);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'We could not load your overview.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialData !== undefined || initialError !== undefined || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [initialData, initialError, loadOverview]);

  if (loading && !data) return <OverviewLoading />;
  if (error && !data) return <OverviewError message={error} onRetry={() => void loadOverview()} />;
  if (!data) return <OverviewLoading />;

  const empty = !hasAnyWork(data);
  const responseCopy = data.counts.requests.open === 0
    ? 'No request is open'
    : `Across ${data.counts.requests.open} open ${data.counts.requests.open === 1 ? 'request' : 'requests'}`;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Restaurant procurement</p>
          <h1>{greeting(data.generatedAt)}</h1>
          <p className={styles.intro}>Here is the work that needs attention across your menus, requests, and supplier quotes.</p>
        </div>
        <Link className={styles.primaryAction} href="/procurement/new">
          New request <ArrowRight aria-hidden="true" />
        </Link>
      </header>

      {error && (
        <div className={styles.inlineError} role="alert">
          <span>{error} The last loaded figures remain on screen.</span>
          <button type="button" onClick={() => void loadOverview()}>Try again</button>
        </div>
      )}

      {empty ? <EmptyWorkspace /> : (
        <>
          <section className={styles.metricGrid} aria-label="Current procurement totals">
            <Link className={styles.metricCard} href="/suppliers">
              <span className={styles.metricIcon}><Building2 aria-hidden="true" /></span>
              <span className={styles.metricLabel}>Active suppliers</span>
              <strong>{data.counts.activeSuppliers}</strong>
              <small>Available for new requests</small>
              <ArrowRight className={styles.cardArrow} aria-hidden="true" />
            </Link>
            <Link className={styles.metricCard} href="/menus">
              <span className={styles.metricIcon}><BookOpenCheck aria-hidden="true" /></span>
              <span className={styles.metricLabel}>Menus ready</span>
              <strong>{data.counts.menus.approved}</strong>
              <small>{data.counts.menus.draft} still {data.counts.menus.draft === 1 ? 'needs' : 'need'} review</small>
              <ArrowRight className={styles.cardArrow} aria-hidden="true" />
            </Link>
            <Link className={styles.metricCard} href="/procurement">
              <span className={styles.metricIcon}><Send aria-hidden="true" /></span>
              <span className={styles.metricLabel}>Open requests</span>
              <strong>{data.counts.requests.open}</strong>
              <small>{data.counts.requests.draft} saved in draft</small>
              <ArrowRight className={styles.cardArrow} aria-hidden="true" />
            </Link>
            <Link className={styles.metricCard} href="/procurement">
              <span className={styles.metricIcon}><CheckCircle2 aria-hidden="true" /></span>
              <span className={styles.metricLabel}>Quotes received</span>
              <strong>{data.counts.quotesReceivedForOpenRequests}</strong>
              <small>{responseCopy}</small>
              <ArrowRight className={styles.cardArrow} aria-hidden="true" />
            </Link>
          </section>

          <section className={styles.workflow} aria-labelledby="workflow-title">
            <div>
              <p className={styles.eyebrow}>Request record</p>
              <h2 id="workflow-title">Current work</h2>
            </div>
            <ol>
              <li><span>Draft</span><strong>{data.counts.requests.draft}</strong></li>
              <li><span>Open</span><strong>{data.counts.requests.open}</strong></li>
              <li><span>Awarded</span><strong>{data.counts.requests.awarded}</strong></li>
            </ol>
            <Link href="/procurement">View all requests <ArrowRight aria-hidden="true" /></Link>
          </section>

          <div className={styles.detailGrid}>
            <section className={styles.panel} aria-labelledby="deadlines-title">
              <header>
                <div>
                  <p className={styles.eyebrow}>Open requests</p>
                  <h2 id="deadlines-title">Nearest quote deadlines</h2>
                </div>
                <Clock3 aria-hidden="true" />
              </header>
              {data.deadlines.length ? (
                <div className={styles.deadlineList}>
                  {data.deadlines.map((deadline) => (
                    <Link href={`/procurement/${encodeURIComponent(deadline.requestId)}`} key={deadline.requestId}>
                      <span className={styles.deadlineDate}>
                        <strong>{formatDateTime(deadline.quoteDeadline)}</strong>
                        <small>{deadlineLabel(deadline.quoteDeadline, data.generatedAt)}</small>
                      </span>
                      <span className={styles.deadlineTitle}>
                        <strong>{deadline.title}</strong>
                        <small>{deadline.quotesReceived} of {deadline.suppliersInvited} responded</small>
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>
                  <Send aria-hidden="true" />
                  <h3>No requests waiting for quotes</h3>
                  <p>Open a checked request when you are ready to ask suppliers for prices.</p>
                  <Link href="/procurement/new">Create a request <ArrowRight aria-hidden="true" /></Link>
                </div>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="awards-title">
              <header>
                <div>
                  <p className={styles.eyebrow}>Committed record</p>
                  <h2 id="awards-title">Recently awarded</h2>
                </div>
                <CheckCircle2 aria-hidden="true" />
              </header>
              {data.recentAwards.length ? (
                <div className={styles.awardList}>
                  {data.recentAwards.map((award) => (
                    <Link href={`/procurement/${encodeURIComponent(award.requestId)}`} key={award.awardId}>
                      <span>
                        <strong>{award.title}</strong>
                        <small>Awarded {formatAwardDate(award.awardedAt)}</small>
                      </span>
                      <span className={styles.awardAmount}>{formatInrFromPaise(award.totalPaise)}</span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>
                  <CheckCircle2 aria-hidden="true" />
                  <h3>No awards yet</h3>
                  <p>Reviewed award totals will appear here after a quote decision is confirmed.</p>
                  <Link href="/procurement">Review requests <ArrowRight aria-hidden="true" /></Link>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
