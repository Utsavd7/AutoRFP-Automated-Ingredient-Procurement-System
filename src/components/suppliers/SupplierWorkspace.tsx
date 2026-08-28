'use client';

import {
  Building2,
  Check,
  Download,
  FileUp,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import styles from './supplier-workspace.module.css';

export type SupplierSummary = {
  id: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  gstin: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type SupplierDraft = Omit<
  SupplierSummary,
  'id' | 'createdAt' | 'updatedAt'
>;

type Problem = {
  detail?: string;
  error?: string;
  errors?: Record<string, string[]>;
};

const emptyDraft: SupplierDraft = {
  businessName: '',
  contactName: '',
  phone: '',
  whatsappNumber: '',
  email: '',
  addressLine: '',
  city: '',
  state: '',
  pin: '',
  gstin: '',
  notes: '',
  isActive: true,
};

function draftFromSupplier(supplier: SupplierSummary): SupplierDraft {
  return {
    businessName: supplier.businessName,
    contactName: supplier.contactName ?? '',
    phone: supplier.phone ?? '',
    whatsappNumber: supplier.whatsappNumber ?? '',
    email: supplier.email ?? '',
    addressLine: supplier.addressLine ?? '',
    city: supplier.city ?? '',
    state: supplier.state ?? '',
    pin: supplier.pin ?? '',
    gstin: supplier.gstin ?? '',
    notes: supplier.notes ?? '',
    isActive: supplier.isActive,
  };
}

function cleanDraft(draft: SupplierDraft) {
  return Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() || null : value,
    ]),
  );
}

function supplierPlace(supplier: SupplierSummary) {
  return [supplier.city, supplier.state].filter(Boolean).join(', ') || 'Location not added';
}

async function readProblem(response: Response, fallback: string) {
  const problem = (await response.json().catch(() => ({}))) as Problem;
  return {
    message: problem.detail || problem.error || fallback,
    errors: problem.errors ?? {},
  };
}

export function SupplierWorkspace({
  initialSuppliers,
  initialError,
  initialNextCursor = null,
}: {
  initialSuppliers?: SupplierSummary[];
  initialError?: string;
  initialNextCursor?: string | null;
}) {
  const [suppliers, setSuppliers] = useState(initialSuppliers ?? []);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | 'all'>('true');
  const [loading, setLoading] = useState(initialSuppliers === undefined);
  const [error, setError] = useState(initialError ?? '');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierSummary | null>(null);
  const [draft, setDraft] = useState<SupplierDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [editorError, setEditorError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const initialLoadStarted = useRef(false);
  const editorDialog = useRef<HTMLElement>(null);
  const savingRef = useRef(false);

  const loadSuppliers = useCallback(async (query = search, filter = activeFilter, cursor?: string) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (query.trim()) params.set('search', query.trim());
      if (filter !== 'all') params.set('active', filter);
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/suppliers?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        const problem = await readProblem(response, 'We could not load suppliers.');
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { suppliers?: SupplierSummary[]; nextCursor?: string | null };
      const loaded = result.suppliers ?? [];
      setSuppliers((current) => cursor
        ? [...new Map([...current, ...loaded].map((supplier) => [supplier.id, supplier])).values()]
        : loaded);
      setNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load suppliers.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activeFilter, search]);

  useEffect(() => {
    if (initialSuppliers !== undefined || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadSuppliers('', 'true');
  }, [initialSuppliers, loadSuppliers]);

  useEffect(() => {
    if (!editorOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = editorDialog.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
    ) ?? [])];
    dialog?.querySelector<HTMLInputElement>('input[name="businessName"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        setEditorOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [editorOpen]);

  function openCreate() {
    savingRef.current = false;
    setSaving(false);
    setEditing(null);
    setDraft(emptyDraft);
    setFieldErrors({});
    setEditorError('');
    setEditorOpen(true);
  }

  function openEdit(supplier: SupplierSummary) {
    savingRef.current = false;
    setSaving(false);
    setEditing(supplier);
    setDraft(draftFromSupplier(supplier));
    setFieldErrors({});
    setEditorError('');
    setEditorOpen(true);
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !draft.businessName.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setEditorError('');
    setFieldErrors({});
    try {
      const response = await fetch(
        editing ? `/api/suppliers/${encodeURIComponent(editing.id)}` : '/api/suppliers',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleanDraft(draft)),
        },
      );
      if (!response.ok) {
        const problem = await readProblem(response, 'We could not save this supplier.');
        setFieldErrors(problem.errors);
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { supplier: SupplierSummary };
      setSuppliers((current) => {
        const withoutSaved = current.filter(({ id }) => id !== result.supplier.id);
        if (
          (activeFilter === 'true' && !result.supplier.isActive) ||
          (activeFilter === 'false' && result.supplier.isActive)
        ) return withoutSaved;
        return [result.supplier, ...withoutSaved];
      });
      setEditorOpen(false);
      setNotice(editing ? 'Supplier updated.' : 'Supplier added.');
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : 'We could not save this supplier.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function deactivate(supplier: SupplierSummary) {
    if (!window.confirm(`Deactivate ${supplier.businessName}? Existing request records will stay unchanged.`)) {
      return;
    }
    setError('');
    const response = await fetch(`/api/suppliers/${encodeURIComponent(supplier.id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const problem = await readProblem(response, 'We could not deactivate this supplier.');
      setError(problem.message);
      return;
    }
    setSuppliers((current) => current.filter(({ id }) => id !== supplier.id));
    setNotice('Supplier deactivated.');
  }

  async function importCsv(file: File | undefined) {
    if (!file || importing) return;
    setImporting(true);
    setError('');
    try {
      const response = await fetch('/api/suppliers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        body: file,
      });
      if (!response.ok) {
        const problem = await readProblem(response, 'Check the CSV and try again.');
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { importedCount?: number };
      setNotice(`${result.importedCount ?? 0} suppliers imported.`);
      await loadSuppliers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not import this CSV.');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setError('');
    try {
      const response = await fetch('/api/suppliers/export', { cache: 'no-store' });
      if (!response.ok) {
        const problem = await readProblem(response, 'We could not export suppliers.');
        throw new Error(problem.message);
      }
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = href;
      link.download = 'quoteplate-suppliers.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not export suppliers.');
    } finally {
      setExporting(false);
    }
  }

  const input = (
    key: keyof SupplierDraft,
    label: string,
    options: { type?: string; placeholder?: string; required?: boolean } = {},
  ) => (
    <label className={styles.field}>
      <span>{label}{options.required ? ' *' : ''}</span>
      <input
        name={key}
        type={options.type ?? 'text'}
        required={options.required}
        placeholder={options.placeholder}
        value={String(draft[key] ?? '')}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
        aria-invalid={Boolean(fieldErrors[key])}
      />
      {fieldErrors[key]?.[0] && <small>{fieldErrors[key][0]}</small>}
    </label>
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Restaurant directory</p>
          <h1>Suppliers</h1>
          <p className={styles.intro}>
            Keep your own supplier contacts in one place. Send each request to the people you already trust.
          </p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={openCreate}>
          <Plus aria-hidden="true" /> Add supplier
        </button>
      </header>

      <section className={styles.toolbar} aria-label="Supplier tools">
        <form
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault();
            void loadSuppliers();
          }}
        >
          <Search aria-hidden="true" />
          <input
            aria-label="Search suppliers"
            placeholder="Search by name, phone, email, city or GSTIN"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <select
          aria-label="Filter suppliers"
          value={activeFilter}
          onChange={(event) => {
            const filter = event.target.value as typeof activeFilter;
            setActiveFilter(filter);
            void loadSuppliers(search, filter);
          }}
        >
          <option value="true">Active suppliers</option>
          <option value="false">Inactive suppliers</option>
          <option value="all">All suppliers</option>
        </select>
        <input
          ref={fileInput}
          className={styles.hiddenInput}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void importCsv(event.target.files?.[0])}
        />
        <button className={styles.secondaryButton} type="button" onClick={() => fileInput.current?.click()} disabled={importing}>
          <FileUp aria-hidden="true" /> {importing ? 'Importing…' : 'Import CSV'}
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={exporting}
          onClick={() => void exportCsv()}
        >
          <Download aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </section>

      {notice && (
        <div className={styles.notice} role="status">
          <Check aria-hidden="true" /> {notice}
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X /></button>
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadSuppliers()}>Try again</button>
        </div>
      )}

      {loading ? (
        <section className={styles.loading} aria-label="Loading suppliers">
          <span /><span /><span />
        </section>
      ) : suppliers.length === 0 ? (
        <section className={styles.empty}>
          <div className={styles.emptyMark}><Building2 aria-hidden="true" /></div>
          <p className={styles.eyebrow}>Start here</p>
          <h2>Add your first supplier</h2>
          <p>No supplier account is needed. Add a contact, then send them a secure quote link when your request is ready.</p>
          <button className={styles.primaryButton} type="button" onClick={openCreate}>
            <Plus aria-hidden="true" /> Add supplier
          </button>
        </section>
      ) : (
        <section className={styles.list} aria-label="Supplier directory">
          <div className={styles.listHeader}>
            <span>{suppliers.length} shown</span>
            <span>Contact</span>
            <span>Location</span>
            <span>Status</span>
            <span aria-hidden="true" />
          </div>
          {suppliers.map((supplier) => (
            <article className={styles.row} key={supplier.id}>
              <div className={styles.identity}>
                <span className={styles.initial}>{supplier.businessName.charAt(0).toUpperCase()}</span>
                <div>
                  <h2>{supplier.businessName}</h2>
                  <p>{supplier.contactName || 'Contact person not added'}</p>
                </div>
              </div>
              <div className={styles.detail}>
                {supplier.phone && <span><Phone aria-hidden="true" />{supplier.phone}</span>}
                {supplier.email && <span><Mail aria-hidden="true" />{supplier.email}</span>}
                {!supplier.phone && !supplier.email && <span>Contact details not added</span>}
              </div>
              <div className={styles.detail}>
                <span><MapPin aria-hidden="true" />{supplierPlace(supplier)}</span>
                {supplier.gstin && <span>GSTIN {supplier.gstin}</span>}
              </div>
              <div>
                <span className={supplier.isActive ? styles.activeBadge : styles.inactiveBadge}>
                  {supplier.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className={styles.actions}>
                <button type="button" aria-label={`Edit ${supplier.businessName}`} onClick={() => openEdit(supplier)}>
                  <MoreHorizontal aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {nextCursor && !loading && (
        <button
          className={styles.loadMore}
          type="button"
          disabled={loadingMore}
          onClick={() => void loadSuppliers(search, activeFilter, nextCursor)}
        >
          {loadingMore ? 'Loading more…' : 'Load more suppliers'}
        </button>
      )}

      {editorOpen && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !savingRef.current) setEditorOpen(false);
        }}>
          <section ref={editorDialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="supplier-editor-title">
            <header>
              <div>
                <p className={styles.eyebrow}>{editing ? 'Supplier record' : 'New supplier'}</p>
                <h2 id="supplier-editor-title">{editing ? `Edit ${editing.businessName}` : 'Add supplier'}</h2>
              </div>
              <button type="button" aria-label="Close supplier form" disabled={saving} onClick={() => setEditorOpen(false)}><X /></button>
            </header>
            <form onSubmit={saveSupplier}>
              {editorError && <div className={styles.dialogError} role="alert">{editorError}</div>}
              <div className={styles.formGrid}>
                {input('businessName', 'Business name', { required: true, placeholder: 'GreenLeaf Fresh Foods' })}
                {input('contactName', 'Contact person', { placeholder: 'Meera Shah' })}
                {input('phone', 'Phone', { type: 'tel', placeholder: '+91 98765 43210' })}
                {input('whatsappNumber', 'WhatsApp number', { type: 'tel', placeholder: '+91 98765 43210' })}
                {input('email', 'Email', { type: 'email', placeholder: 'orders@example.com' })}
                {input('gstin', 'GSTIN', { placeholder: '27ABCDE1234F1Z5' })}
                <div className={styles.fullWidth}>{input('addressLine', 'Address', { placeholder: 'APMC Market, Vashi' })}</div>
                {input('city', 'City', { placeholder: 'Navi Mumbai' })}
                {input('state', 'State', { placeholder: 'Maharashtra' })}
                {input('pin', 'PIN code', { placeholder: '400703' })}
                <label className={styles.field}>
                  <span>Status</span>
                  <select
                    value={draft.isActive ? 'active' : 'inactive'}
                    onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.value === 'active' }))}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label className={`${styles.field} ${styles.fullWidth}`}>
                  <span>Notes</span>
                  <textarea
                    rows={3}
                    placeholder="Delivery timing, payment terms or useful reminders"
                    value={draft.notes ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                  />
                </label>
              </div>
              <footer>
                {editing?.isActive && (
                  <button className={styles.dangerButton} type="button" onClick={() => {
                    setEditorOpen(false);
                    void deactivate(editing);
                  }} disabled={saving}>
                    Deactivate
                  </button>
                )}
                <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</button>
                <button className={styles.primaryButton} type="submit" disabled={saving || !draft.businessName.trim()}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add supplier'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
