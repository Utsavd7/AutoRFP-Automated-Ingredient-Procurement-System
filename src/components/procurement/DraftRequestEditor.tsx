'use client';

import { Check, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import {
  buildDefaultSourcingSelection,
  type RequestItemsV1,
  type RequestSourcingV1,
} from '@/lib/procurement/request-document';

import styles from './draft-request-editor.module.css';

type DraftSupplierGrant = {
  supplierId: string;
  supplier: { id: string; businessName: string; isActive: boolean };
};

export type EditableProcurementRequest = {
  id: string;
  title: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
  version: number;
  deliveryDetails: {
    addressLine?: string;
    city?: string;
    state?: string;
    pin?: string;
    instructions?: string;
  };
  deliveryDate: string;
  quoteDeadline: string;
  commercialTerms: string | null;
  items: RequestItemsV1;
  sourcing: RequestSourcingV1;
  supplierRequests: DraftSupplierGrant[];
};

type SupplierChoice = {
  id: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  isActive: boolean;
  relationshipType: 'CURRENT' | 'SELECTED_NEW';
};

function indiaDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 330 * 60 * 1_000).toISOString().slice(0, 16);
}

function indiaDeadlineIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function problem(response: Response, fallback: string) {
  return response.json().catch(() => ({})).then((body: {
    detail?: string;
    errors?: Record<string, string[]>;
  }) => ({ message: body.detail || fallback, fields: body.errors ?? {} }));
}

async function loadActiveSuppliers(signal: AbortSignal) {
  const suppliers: SupplierChoice[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ active: 'true', limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`/api/suppliers?${query}`, {
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      throw new Error((await problem(response, 'We could not load suppliers.')).message);
    }
    const result = (await response.json()) as {
      suppliers?: SupplierChoice[];
      nextCursor?: string | null;
    };
    suppliers.push(...(result.suppliers ?? []));
    cursor = result.nextCursor ?? null;
    if (!cursor) return suppliers;
  }
  throw new Error('The supplier list is larger than this request can support.');
}

export function DraftRequestEditor({
  request,
  onCancel,
  onSaved,
}: {
  request: EditableProcurementRequest;
  onCancel: () => void;
  onSaved: (request: EditableProcurementRequest) => void;
}) {
  const [title, setTitle] = useState(request.title);
  const [supplierIds, setSupplierIds] = useState(
    request.supplierRequests.map(({ supplierId }) => supplierId),
  );
  const [openToNewSuppliers, setOpenToNewSuppliers] = useState(
    request.sourcing.default.acceptVerifiedApplications,
  );
  const [addressLine, setAddressLine] = useState(request.deliveryDetails.addressLine ?? '');
  const [city, setCity] = useState(request.deliveryDetails.city ?? '');
  const [state, setState] = useState(request.deliveryDetails.state ?? '');
  const [pin, setPin] = useState(request.deliveryDetails.pin ?? '');
  const [instructions, setInstructions] = useState(request.deliveryDetails.instructions ?? '');
  const [deliveryDate, setDeliveryDate] = useState(request.deliveryDate.slice(0, 10));
  const [quoteDeadline, setQuoteDeadline] = useState(indiaDateTimeInput(request.quoteDeadline));
  const [commercialTerms, setCommercialTerms] = useState(request.commercialTerms ?? '');
  const [suppliers, setSuppliers] = useState<SupplierChoice[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const controller = new AbortController();
    void loadActiveSuppliers(controller.signal)
      .then((loaded) => setSuppliers(loaded))
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'We could not load suppliers.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSuppliers(false);
      });
    return () => controller.abort();
  }, []);

  const currentSuppliers = useMemo(() => {
    const byId = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    for (const grant of request.supplierRequests) {
      if (!byId.has(grant.supplierId) && grant.supplier.isActive) {
        byId.set(grant.supplierId, {
          id: grant.supplierId,
          businessName: grant.supplier.businessName,
          contactName: null,
          phone: null,
          city: null,
          isActive: true,
          relationshipType: request.sourcing.default.selectedNewSupplierIds.includes(grant.supplierId)
            ? 'SELECTED_NEW'
            : 'CURRENT',
        });
      }
    }
    return [...byId.values()].sort((a, b) =>
      a.businessName.localeCompare(b.businessName, 'en-IN'),
    );
  }, [
    request.sourcing.default.selectedNewSupplierIds,
    request.supplierRequests,
    suppliers,
  ]);

  const deadlineIso = indiaDeadlineIso(quoteDeadline);
  const valid = Boolean(
    title.trim() &&
    (supplierIds.length > 0 || openToNewSuppliers) &&
    addressLine.trim() &&
    city.trim() &&
    state.trim() &&
    /^[1-9]\d{5}$/.test(pin) &&
    /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) &&
    deadlineIso &&
    new Date(deadlineIso).getTime() < new Date(`${deliveryDate}T00:00:00+05:30`).getTime(),
  );

  function toggleSupplier(id: string) {
    setSupplierIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving || request.status !== 'DRAFT') return;
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      const defaultSourcing = buildDefaultSourcingSelection(
        currentSuppliers,
        supplierIds,
        openToNewSuppliers,
      );
      const response = await fetch(`/api/requests/${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: request.version,
          title: title.trim(),
          items: {
            v: 1,
            items: request.items.items.map((item) => ({
              ...item,
              sourcingOverride: null,
            })),
          },
          sourcing: {
            v: 1,
            default: defaultSourcing,
          },
          deliveryDetails: {
            addressLine: addressLine.trim(),
            city: city.trim(),
            state: state.trim(),
            pin,
            ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          },
          deliveryDate,
          quoteDeadline: deadlineIso,
          commercialTerms: commercialTerms.trim() || null,
        }),
      });
      if (!response.ok) {
        const issue = await problem(response, 'We could not save the draft.');
        setFieldErrors(issue.fields);
        throw new Error(issue.message);
      }
      const result = (await response.json()) as { request?: EditableProcurementRequest };
      if (!result.request) throw new Error('The updated draft was not returned.');
      onSaved(result.request);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not save the draft.');
      setSaving(false);
    }
  }

  return (
    <form className={styles.editor} onSubmit={save} aria-label="Edit procurement draft">
      <header>
        <div>
          <p>Edit before sharing</p>
          <h2>Review the draft</h2>
        </div>
        <button type="button" className={styles.close} onClick={onCancel} aria-label="Close draft editor">
          <X aria-hidden="true" />
        </button>
      </header>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.grid}>
        <label className={styles.full}>
          <span>Request title *</span>
          <input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          {fieldErrors.title?.[0] && <small>{fieldErrors.title[0]}</small>}
        </label>
        <label className={styles.full}>
          <span>Delivery address *</span>
          <input value={addressLine} onChange={(event) => setAddressLine(event.target.value)} />
        </label>
        <label><span>City *</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label>
        <label><span>State *</span><input value={state} onChange={(event) => setState(event.target.value)} /></label>
        <label><span>PIN code *</span><input inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} /></label>
        <label><span>Delivery date *</span><input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
        <label className={styles.full}><span>Quote deadline (India time) *</span><input type="datetime-local" value={quoteDeadline} onChange={(event) => setQuoteDeadline(event.target.value)} /></label>
        <label className={styles.full}><span>Delivery instructions</span><textarea rows={2} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
        <label className={styles.full}><span>Commercial terms</span><textarea rows={3} value={commercialTerms} onChange={(event) => setCommercialTerms(event.target.value)} /></label>
      </div>
      <fieldset>
        <legend>Suppliers *</legend>
        <label className={openToNewSuppliers ? styles.selectedSupplier : styles.supplier}>
          <input
            type="checkbox"
            checked={openToNewSuppliers}
            onChange={(event) => setOpenToNewSuppliers(event.target.checked)}
          />
          <span>
            <strong>Also invite new verified suppliers</strong>
            <small>You approve every applicant before they can quote.</small>
          </span>
          {openToNewSuppliers && <Check aria-hidden="true" />}
        </label>
        {loadingSuppliers ? <p className={styles.help}>Loading suppliers…</p> : currentSuppliers.length === 0 ? <p className={styles.help}>Add an active supplier before opening this request.</p> : (
          <div className={styles.suppliers}>
            {currentSuppliers.map((supplier) => (
              <label className={supplierIds.includes(supplier.id) ? styles.selectedSupplier : styles.supplier} key={supplier.id}>
                <input type="checkbox" checked={supplierIds.includes(supplier.id)} onChange={() => toggleSupplier(supplier.id)} />
                <span><strong>{supplier.businessName}</strong><small>{supplier.contactName || supplier.city || supplier.phone || 'Active supplier'}</small></span>
                {supplierIds.includes(supplier.id) && <Check aria-hidden="true" />}
              </label>
            ))}
          </div>
        )}
        {(fieldErrors.sourcing?.[0] || fieldErrors.items?.[0]) && <small className={styles.fieldError}>{fieldErrors.sourcing?.[0] || fieldErrors.items?.[0]}</small>}
      </fieldset>
      {!valid && <p className={styles.help}>Complete the required fields, choose a saved supplier or invite new suppliers, and keep the deadline before the delivery date.</p>}
      <footer>
        <button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.primary} disabled={!valid || saving || loadingSuppliers}>{saving ? 'Saving…' : 'Save changes'}</button>
      </footer>
    </form>
  );
}
