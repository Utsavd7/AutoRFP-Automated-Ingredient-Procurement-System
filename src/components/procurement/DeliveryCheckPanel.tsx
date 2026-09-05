'use client';

import { AlertTriangle, CheckCircle2, ClipboardCheck, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
import { formatIndiaDate as displayDate } from '@/lib/domain/india-date';
import { formatInr, parseInrToPaise } from '@/lib/domain/money';
import styles from './request-detail.module.css';

type IssueCode = 'LATE' | 'MISSING_QUANTITY' | 'WRONG_ITEM' | 'QUALITY' | 'PRICE_DIFFERENCE' | 'OTHER';

type SavedCheck = {
  supplierId: string;
  outcome: 'MATCHED' | 'ISSUES';
  invoiceTotalPaise: string;
  differencePaise: string;
  issueCodes: IssueCode[];
  note: string | null;
  checkedAt: string;
  hasProblem: boolean;
};

export type DeliveryReceivingSummary = {
  checkedCount: number;
  totalCount: number;
  complete: boolean;
  problemCount: number;
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    deliveryDate: string;
    expectedTotalPaise: string;
    check: SavedCheck | null;
  }>;
};

const issueOptions: Array<{ code: IssueCode; label: string }> = [
  { code: 'LATE', label: 'Late delivery' },
  { code: 'MISSING_QUANTITY', label: 'Missing quantity' },
  { code: 'WRONG_ITEM', label: 'Wrong item' },
  { code: 'QUALITY', label: 'Poor quality' },
  { code: 'PRICE_DIFFERENCE', label: 'Price difference' },
  { code: 'OTHER', label: 'Other problem' },
];

function rupeesInput(paise: string) {
  const value = BigInt(paise);
  const whole = value / BigInt(100);
  const fraction = (value % BigInt(100)).toString().padStart(2, '0');
  return fraction === '00' ? whole.toString() : `${whole}.${fraction}`;
}

function differenceText(value: string) {
  const difference = BigInt(value);
  if (difference === BigInt(0)) return 'Matches accepted total';
  const absolute = difference < BigInt(0) ? -difference : difference;
  return `${formatInr(absolute.toString())} ${difference > BigInt(0) ? 'higher' : 'lower'}`;
}

function SupplierCheckForm({ awardId, supplier, onSaved }: {
  awardId: string;
  supplier: DeliveryReceivingSummary['suppliers'][number];
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(!supplier.check);
  const [invoiceInr, setInvoiceInr] = useState(supplier.check ? rupeesInput(supplier.check.invoiceTotalPaise) : '');
  const [outcome, setOutcome] = useState<'MATCHED' | 'ISSUES'>(supplier.check?.outcome ?? 'MATCHED');
  const [issueCodes, setIssueCodes] = useState<IssueCode[]>(supplier.check?.issueCodes ?? []);
  const [note, setNote] = useState(supplier.check?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleIssue(code: IssueCode) {
    setIssueCodes((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    let invoiceTotalPaise: string;
    try {
      const paise = parseInrToPaise(invoiceInr);
      if (paise <= BigInt(0)) throw new RangeError();
      invoiceTotalPaise = paise.toString();
    } catch {
      setError('Enter the invoice total in rupees.');
      return;
    }
    if (outcome === 'ISSUES' && issueCodes.length === 0) {
      setError('Choose at least one delivery problem.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await workspaceMutationFetch(`/api/awards/${encodeURIComponent(awardId)}/receiving`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: supplier.supplierId,
          outcome,
          invoiceTotalPaise,
          issueCodes: outcome === 'ISSUES' ? issueCodes : [],
          note: note.trim() || null,
          expectedCheckedAt: supplier.check?.checkedAt ?? null,
        }),
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(problem.detail || 'We could not save this delivery check.');
      }
      await onSaved();
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not save this delivery check.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing && supplier.check) {
    const check = supplier.check;
    return (
      <article className={check.hasProblem ? styles.deliveryIssue : styles.deliveryMatched}>
        <header>
          <span>
            {check.hasProblem ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            <span><strong>{supplier.supplierName}</strong><small>Delivery {displayDate(supplier.deliveryDate)}</small></span>
          </span>
          <i>{check.hasProblem ? 'Needs attention' : 'Received as agreed'}</i>
        </header>
        <dl>
          <div><dt>Accepted total</dt><dd>{formatInr(supplier.expectedTotalPaise)}</dd></div>
          <div><dt>Invoice total</dt><dd>{formatInr(check.invoiceTotalPaise)}</dd></div>
          <div><dt>Invoice difference</dt><dd>{differenceText(check.differencePaise)}</dd></div>
        </dl>
        {check.issueCodes.length > 0 && <p>{check.issueCodes.map((code) => issueOptions.find((option) => option.code === code)?.label).join(' · ')}</p>}
        {check.note && <blockquote>{check.note}</blockquote>}
        <footer><small>Checked {displayDate(check.checkedAt, true)}</small><button type="button" onClick={() => setEditing(true)}>Update check</button></footer>
      </article>
    );
  }

  return (
    <form className={styles.deliveryForm} onSubmit={save}>
      <header>
        <span><ClipboardCheck aria-hidden="true" /><span><strong>{supplier.supplierName}</strong><small>Expected {formatInr(supplier.expectedTotalPaise)} · delivery {displayDate(supplier.deliveryDate)}</small></span></span>
        {supplier.check && <button type="button" onClick={() => setEditing(false)}>Cancel</button>}
      </header>
      <label className={styles.invoiceField}><span>Invoice total in rupees *</span><span><b>₹</b><input inputMode="decimal" value={invoiceInr} placeholder="1,250.00" onChange={(event) => setInvoiceInr(event.target.value.replace(/,/g, ''))} /></span></label>
      <fieldset className={styles.deliveryOutcome}>
        <legend>How was the delivery?</legend>
        <label><input type="radio" name={`outcome-${supplier.supplierId}`} checked={outcome === 'MATCHED'} onChange={() => { setOutcome('MATCHED'); setIssueCodes([]); }} />Received as agreed</label>
        <label><input type="radio" name={`outcome-${supplier.supplierId}`} checked={outcome === 'ISSUES'} onChange={() => setOutcome('ISSUES')} />Report a problem</label>
      </fieldset>
      {outcome === 'ISSUES' && (
        <div className={styles.deliveryProblems}><span>What went wrong?</span><div>{issueOptions.map((option) => (
          <label key={option.code}><input type="checkbox" checked={issueCodes.includes(option.code)} onChange={() => toggleIssue(option.code)} />{option.label}</label>
        ))}</div></div>
      )}
      <label className={styles.deliveryNote}><span>Note, if useful</span><textarea maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: 2 kg tomato was missing." /></label>
      {error && <p className={styles.deliveryError} role="alert">{error}</p>}
      <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save delivery check'}</button>
    </form>
  );
}

export function DeliveryCheckPanel({ awardId, requestId, receiving, onSaved }: {
  awardId: string;
  requestId: string;
  receiving: DeliveryReceivingSummary;
  onSaved: () => Promise<void> | void;
}) {
  return (
    <section className={`${styles.panel} ${styles.deliveryPanel}`} aria-labelledby="delivery-check-heading">
      <header><div><p className={styles.eyebrow}>After delivery</p><h2 id="delivery-check-heading">Check delivery</h2></div><span>{receiving.checkedCount} of {receiving.totalCount} checked</span></header>
      <p className={styles.deliveryIntro}>Enter the supplier invoice total and record whether the order arrived as agreed.</p>
      <div className={styles.deliveryGrid}>{receiving.suppliers.map((supplier) => (
        <SupplierCheckForm key={supplier.supplierId} awardId={awardId} supplier={supplier} onSaved={onSaved} />
      ))}</div>
      {receiving.complete && (
        <div className={styles.repeatOrder}>
          <span><RotateCcw aria-hidden="true" /><span><strong>All deliveries checked</strong><small>Your invoice and supplier record is ready for the next purchase.</small></span></span>
          <Link href={`/history?repeat=${encodeURIComponent(requestId)}`}>Repeat this order</Link>
        </div>
      )}
    </section>
  );
}
