'use client';

import { ArrowLeft, CalendarDays, Check, ChevronDown, MapPin, Store, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';

import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
import { buildDefaultSourcingSelection } from '@/lib/procurement/request-document';

import styles from './new-request-form.module.css';

type MenuSummary = {
  id: string;
  name: string;
  status: 'DRAFT' | 'APPROVED';
  version: number;
};

type ReviewedMenu = MenuSummary & { document: MenuDocumentV1 };

type SupplierChoice = {
  id: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  isActive: boolean;
  relationshipType: 'CURRENT' | 'SELECTED_NEW';
};

type AccountDelivery = { addressLine: string; city: string; state: string; pin: string };

type InitialData = {
  menus: MenuSummary[];
  suppliers: SupplierChoice[];
  account: AccountDelivery;
  menuNextCursor?: string | null;
  supplierNextCursor?: string | null;
};

async function problem(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
    errors?: Record<string, string[]>;
  };
  return { message: body.detail || body.error || fallback, fields: body.errors ?? {} };
}

function indiaDeadlineIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function deadlineBeforeDelivery(deadlineValue: string, deliveryValue: string) {
  const deadline = indiaDeadlineIso(deadlineValue);
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryValue)) return false;
  const deliveryStart = new Date(`${deliveryValue}T00:00:00+05:30`);
  return !Number.isNaN(deliveryStart.getTime()) && new Date(deadline).getTime() < deliveryStart.getTime();
}

export function NewRequestForm({ initialData }: { initialData?: InitialData }) {
  const router = useRouter();
  const [menus, setMenus] = useState(initialData?.menus.filter(({ status }) => status === 'APPROVED') ?? []);
  const [suppliers, setSuppliers] = useState(initialData?.suppliers ?? []);
  const [menuNextCursor, setMenuNextCursor] = useState(initialData?.menuNextCursor ?? null);
  const [supplierNextCursor, setSupplierNextCursor] = useState(initialData?.supplierNextCursor ?? null);
  const [loadingMoreMenus, setLoadingMoreMenus] = useState(false);
  const [loadingMoreSuppliers, setLoadingMoreSuppliers] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState<ReviewedMenu | null>(null);
  const [menuId, setMenuId] = useState('');
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [openToNewSuppliers, setOpenToNewSuppliers] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'ALL' | 'SELECTED'>('ALL');
  const [ingredientIds, setIngredientIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [addressLine, setAddressLine] = useState(initialData?.account.addressLine ?? '');
  const [city, setCity] = useState(initialData?.account.city ?? '');
  const [state, setState] = useState(initialData?.account.state ?? '');
  const [pin, setPin] = useState(initialData?.account.pin ?? '');
  const [instructions, setInstructions] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [quoteDeadline, setQuoteDeadline] = useState('');
  const [commercialTerms, setCommercialTerms] = useState('');
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const initialLoadStarted = useRef(false);
  const menuRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    if (initialData || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const [menuResponse, supplierResponse, accountResponse] = await Promise.all([
          fetch('/api/menus?limit=50', { cache: 'no-store' }),
          fetch('/api/suppliers?active=true&limit=50', { cache: 'no-store' }),
          fetch('/api/account', { cache: 'no-store' }),
        ]);
        if (!menuResponse.ok) throw new Error(await problem(menuResponse, 'We could not load approved menus.').then(({ message }) => message));
        if (!supplierResponse.ok) throw new Error(await problem(supplierResponse, 'We could not load suppliers.').then(({ message }) => message));
        if (!accountResponse.ok) throw new Error(await problem(accountResponse, 'We could not load the delivery address.').then(({ message }) => message));
        const menuResult = (await menuResponse.json()) as { menus?: MenuSummary[]; nextCursor?: string | null };
        const supplierResult = (await supplierResponse.json()) as { suppliers?: SupplierChoice[]; nextCursor?: string | null };
        const accountResult = (await accountResponse.json()) as { account?: AccountDelivery };
        setMenus((menuResult.menus ?? []).filter(({ status }) => status === 'APPROVED'));
        setSuppliers(supplierResult.suppliers ?? []);
        setMenuNextCursor(menuResult.nextCursor ?? null);
        setSupplierNextCursor(supplierResult.nextCursor ?? null);
        if (accountResult.account) {
          setAddressLine(accountResult.account.addressLine);
          setCity(accountResult.account.city);
          setState(accountResult.account.state);
          setPin(accountResult.account.pin);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'We could not prepare this request.');
      } finally {
        setLoading(false);
      }
    })();
  }, [initialData]);

  useEffect(() => () => menuRequest.current?.abort(), []);

  async function loadMoreMenus() {
    if (!menuNextCursor || loadingMoreMenus) return;
    setLoadingMoreMenus(true);
    setError('');
    try {
      const response = await fetch(`/api/menus?limit=50&cursor=${encodeURIComponent(menuNextCursor)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await problem(response, 'We could not load more approved menus.')).message);
      const result = (await response.json()) as { menus?: MenuSummary[]; nextCursor?: string | null };
      const approved = (result.menus ?? []).filter(({ status }) => status === 'APPROVED');
      setMenus((current) => [...new Map([...current, ...approved].map((menu) => [menu.id, menu])).values()]);
      setMenuNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load more approved menus.');
    } finally {
      setLoadingMoreMenus(false);
    }
  }

  async function loadMoreSuppliers() {
    if (!supplierNextCursor || loadingMoreSuppliers) return;
    setLoadingMoreSuppliers(true);
    setError('');
    try {
      const response = await fetch(`/api/suppliers?active=true&limit=50&cursor=${encodeURIComponent(supplierNextCursor)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await problem(response, 'We could not load more suppliers.')).message);
      const result = (await response.json()) as { suppliers?: SupplierChoice[]; nextCursor?: string | null };
      setSuppliers((current) => [...new Map([...current, ...(result.suppliers ?? [])].map((supplier) => [supplier.id, supplier])).values()]);
      setSupplierNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load more suppliers.');
    } finally {
      setLoadingMoreSuppliers(false);
    }
  }

  async function chooseMenu(id: string) {
    menuRequest.current?.abort();
    setMenuId(id);
    setSelectedMenu(null);
    setIngredientIds([]);
    setSelectionMode('ALL');
    if (!id) {
      setLoadingMenu(false);
      return;
    }
    const controller = new AbortController();
    menuRequest.current = controller;
    setLoadingMenu(true);
    setError('');
    try {
      const response = await fetch(`/api/menus/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        const message = (await problem(response, 'We could not load this menu.')).message;
        if (menuRequest.current === controller) setError(message);
        return;
      }
      const result = (await response.json()) as { menu: ReviewedMenu };
      if (menuRequest.current === controller) setSelectedMenu(result.menu);
    } catch (caught) {
      if (menuRequest.current === controller && !(caught instanceof Error && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : 'We could not load this menu.');
      }
    } finally {
      if (menuRequest.current === controller) {
        menuRequest.current = null;
        setLoadingMenu(false);
      }
    }
  }

  function toggleSupplier(id: string) {
    setSupplierIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleIngredient(id: string) {
    setIngredientIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  const valid = Boolean(
    title.trim() && menuId && (supplierIds.length > 0 || openToNewSuppliers) && addressLine.trim() && city.trim() &&
    state.trim() && /^[1-9]\d{5}$/.test(pin) && deliveryDate && deadlineBeforeDelivery(quoteDeadline, deliveryDate) &&
    (selectionMode === 'ALL' || ingredientIds.length > 0),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      if (!selectedMenu) throw new Error('Choose an approved menu before saving.');
      const selectedItemIds = selectionMode === 'ALL'
        ? selectedMenu.document.dishes.flatMap(({ ingredients }) =>
            ingredients.map(({ id }) => id))
        : ingredientIds;
      const defaultSourcing = buildDefaultSourcingSelection(
        suppliers,
        supplierIds,
        openToNewSuppliers,
      );
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          menuId,
          selectedItemIds,
          defaultSourcing,
          sourcingOverrides: {},
          deliveryDetails: {
            addressLine: addressLine.trim(), city: city.trim(), state: state.trim(), pin,
            ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          },
          deliveryDate,
          quoteDeadline: indiaDeadlineIso(quoteDeadline),
          commercialTerms: commercialTerms.trim() || null,
        }),
      });
      if (!response.ok) {
        const issue = await problem(response, 'We could not save this request.');
        setFieldErrors(issue.fields);
        throw new Error(issue.message);
      }
      const result = (await response.json()) as { request?: { id: string } };
      if (!result.request?.id) throw new Error('The saved request was not returned.');
      router.push(`/procurement/${encodeURIComponent(result.request.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not save this request.');
      setSaving(false);
    }
  }

  if (loading) return <main className={styles.page}><div className={styles.loading} aria-label="Preparing request"><span /><span /><span /></div></main>;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" onClick={() => router.push('/procurement')}><ArrowLeft aria-hidden="true" /> Procurement</button>
        <p className={styles.eyebrow}>Draft</p>
        <h1>New supplier price request</h1>
        <p>Choose what you need, who should quote, and when the order must arrive.</p>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}
      <form className={styles.form} onSubmit={submit}>
        <section className={styles.section}>
          <div className={styles.sectionNumber}>01</div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionTitle}><div><h2>Request details</h2><p>Choose an approved menu and the ingredients you need.</p></div><Store aria-hidden="true" /></div>
            <label className={styles.field}>
              <span>Request title *</span>
              <input value={title} maxLength={160} placeholder="Fresh produce · Week 36" onChange={(event) => setTitle(event.target.value)} />
              {fieldErrors.title?.[0] && <small>{fieldErrors.title[0]}</small>}
            </label>
            <label className={`${styles.field} ${styles.selectField}`}>
              <span>Approved menu *</span>
              <select value={menuId} disabled={loadingMenu} onChange={(event) => void chooseMenu(event.target.value)}>
                <option value="">Choose an approved menu</option>
                {menus.map((menu) => <option value={menu.id} key={menu.id}>{menu.name}</option>)}
              </select><ChevronDown aria-hidden="true" />
            </label>
            {loadingMenu && <p className={styles.choiceStatus} role="status">Loading the checked ingredient list…</p>}
            {menuNextCursor && <button className={styles.choiceMore} type="button" disabled={loadingMoreMenus} onClick={() => void loadMoreMenus()}>{loadingMoreMenus ? 'Loading…' : 'Load more approved menus'}</button>}
            {menus.length === 0 && (
              <div className={styles.inlineEmpty}>No approved menu yet. <button type="button" onClick={() => router.push('/menus')}>Review a menu first</button>.</div>
            )}
            {selectedMenu && (
              <div className={styles.demand}>
                <div className={styles.segmented}>
                  <button type="button" className={selectionMode === 'ALL' ? styles.selected : ''} onClick={() => setSelectionMode('ALL')}>All ingredients</button>
                  <button type="button" className={selectionMode === 'SELECTED' ? styles.selected : ''} onClick={() => setSelectionMode('SELECTED')}>Choose ingredients</button>
                </div>
                {selectionMode === 'SELECTED' && selectedMenu.document.dishes.map((dish) => (
                  <fieldset key={dish.id}>
                    <legend>{dish.name}</legend>
                    {dish.ingredients.map((ingredient) => (
                      <label className={styles.checkboxRow} key={ingredient.id}>
                        <input type="checkbox" checked={ingredientIds.includes(ingredient.id)} onChange={() => toggleIngredient(ingredient.id)} />
                        <span><strong>{ingredient.name}</strong><small>{ingredient.quantity} {ingredient.unit.toLowerCase()}</small></span>
                        {ingredientIds.includes(ingredient.id) && <Check aria-hidden="true" />}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
            {supplierNextCursor && <button className={styles.choiceMore} type="button" disabled={loadingMoreSuppliers} onClick={() => void loadMoreSuppliers()}>{loadingMoreSuppliers ? 'Loading…' : 'Load more suppliers'}</button>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionNumber}>02</div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionTitle}><div><h2>Suppliers</h2><p>Choose the suppliers who should receive their own secure link.</p></div><Users aria-hidden="true" /></div>
            <label className={openToNewSuppliers ? styles.selectedOpenSupplier : styles.openSupplier}>
              <input
                type="checkbox"
                checked={openToNewSuppliers}
                onChange={(event) => setOpenToNewSuppliers(event.target.checked)}
              />
              <span>
                <strong>Also invite new verified suppliers</strong>
                <small>You will get one public application link after opening this request. You approve every supplier before they can quote.</small>
              </span>
              {openToNewSuppliers && <Check aria-hidden="true" />}
            </label>
            {suppliers.length === 0 ? (
              <div className={styles.inlineEmpty}>No saved supplier yet. You can invite new suppliers above or <button type="button" onClick={() => router.push('/suppliers')}>add a supplier</button>.</div>
            ) : (
              <div className={styles.supplierGrid}>
                {suppliers.map((supplier) => (
                  <label className={supplierIds.includes(supplier.id) ? styles.selectedSupplier : styles.supplier} key={supplier.id}>
                    <input type="checkbox" checked={supplierIds.includes(supplier.id)} onChange={() => toggleSupplier(supplier.id)} />
                    <span className={styles.supplierInitial}>{supplier.businessName.charAt(0).toUpperCase()}</span>
                    <span><strong>{supplier.businessName}</strong><small>{supplier.relationshipType === 'CURRENT' ? 'Regular supplier' : 'New supplier'} · {supplier.contactName || supplier.city || supplier.phone || 'Contact details not added'}</small></span>
                    {supplierIds.includes(supplier.id) && <Check aria-hidden="true" />}
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionNumber}>03</div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionTitle}><div><h2>Delivery and timing</h2><p>These details are shown to every selected supplier.</p></div><MapPin aria-hidden="true" /></div>
            <div className={styles.twoColumns}>
              <label className={`${styles.field} ${styles.full}`}><span>Delivery address *</span><input value={addressLine} onChange={(event) => setAddressLine(event.target.value)} /></label>
              <label className={styles.field}><span>City *</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label>
              <label className={styles.field}><span>State *</span><input value={state} onChange={(event) => setState(event.target.value)} /></label>
              <label className={styles.field}><span>PIN code *</span><input inputMode="numeric" value={pin} maxLength={6} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} /></label>
              <label className={styles.field}><span>Delivery date *</span><input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
              <label className={styles.field}><span>Quote deadline (India time) *</span><input type="datetime-local" value={quoteDeadline} onChange={(event) => setQuoteDeadline(event.target.value)} /></label>
              <label className={`${styles.field} ${styles.full}`}><span>Delivery instructions</span><textarea rows={3} value={instructions} placeholder="Use the service entrance. Delivery before 8:00 AM." onChange={(event) => setInstructions(event.target.value)} /></label>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionNumber}>04</div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionTitle}><div><h2>Commercial terms</h2><p>Add only the terms every supplier should see.</p></div><CalendarDays aria-hidden="true" /></div>
            <label className={styles.field}><span>Terms or notes</span><textarea rows={4} value={commercialTerms} placeholder="Rates should include packing. Payment within 15 days of accepted delivery." onChange={(event) => setCommercialTerms(event.target.value)} /></label>
          </div>
        </section>

        <footer className={styles.actions}>
          <span>Nothing is shared yet. You will review the draft before opening it.</span>
          <button className={styles.secondaryButton} type="button" onClick={() => router.push('/procurement')}>Cancel</button>
          <button className={styles.primaryButton} type="submit" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save draft'}</button>
        </footer>
      </form>
    </main>
  );
}
