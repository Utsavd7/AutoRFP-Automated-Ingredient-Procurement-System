'use client';

import { ArrowRight, BookOpen, CheckCircle2, Clock3, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import styles from './menu-workspace.module.css';

export type MenuSummary = {
  id: string;
  name: string;
  status: 'DRAFT' | 'APPROVED';
  version: number;
  approvedAt: string | null;
  updatedAt: string;
};

async function responseMessage(response: Response, fallback: string) {
  const problem = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
  };
  return problem.detail || problem.error || fallback;
}

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently updated';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function MenuWorkspace({
  initialMenus,
  initialError,
  initialNextCursor = null,
}: {
  initialMenus?: MenuSummary[];
  initialError?: string;
  initialNextCursor?: string | null;
}) {
  const router = useRouter();
  const [menus, setMenus] = useState(initialMenus ?? []);
  const [loading, setLoading] = useState(initialMenus === undefined);
  const [error, setError] = useState(initialError ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [menuText, setMenuText] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const initialLoadStarted = useRef(false);
  const createDialog = useRef<HTMLElement>(null);
  const savingRef = useRef(false);

  const loadMenus = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/menus?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseMessage(response, 'We could not load menus.'));
      const result = (await response.json()) as { menus?: MenuSummary[]; nextCursor?: string | null };
      const loaded = result.menus ?? [];
      setMenus((current) => cursor
        ? [...new Map([...current, ...loaded].map((menu) => [menu.id, menu])).values()]
        : loaded);
      setNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load menus.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (initialMenus !== undefined || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadMenus();
  }, [initialMenus, loadMenus]);

  useEffect(() => {
    if (!createOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = createDialog.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') ?? [])];
    dialog?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        setCreateOpen(false);
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
  }, [createOpen]);

  function openCreate() {
    savingRef.current = false;
    setSaving(false);
    setCreateError('');
    setCreateOpen(true);
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !menuText.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setCreateError('');
    try {
      const response = await fetch('/api/parse-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuText }),
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, 'We could not save this menu draft.'));
      }
      const result = (await response.json()) as { menuId?: string };
      if (!result.menuId) throw new Error('The menu draft was not returned.');
      router.push(`/menus/${encodeURIComponent(result.menuId)}`);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'We could not save this menu draft.');
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Reviewed demand</p>
          <h1>Menus</h1>
          <p className={styles.intro}>
            Turn the dishes you serve into a checked ingredient list before asking suppliers for prices.
          </p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={openCreate}>
          <Plus aria-hidden="true" /> Add menu
        </button>
      </header>

      <aside className={styles.explainer}>
        <span><strong>1</strong> Paste dish names</span>
        <ArrowRight aria-hidden="true" />
        <span><strong>2</strong> Add ingredients and quantities</span>
        <ArrowRight aria-hidden="true" />
        <span><strong>3</strong> Approve when checked</span>
        <small>Nothing is sent to suppliers until you open a procurement request.</small>
      </aside>

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadMenus()}>Try again</button>
        </div>
      )}

      {loading ? (
        <section className={styles.loading} aria-label="Loading menus"><span /><span /><span /></section>
      ) : menus.length === 0 ? (
        <section className={styles.empty}>
          <div className={styles.emptyMark}><BookOpen aria-hidden="true" /></div>
          <p className={styles.eyebrow}>Your first step</p>
          <h2>Add your restaurant menu</h2>
          <p>Paste one dish per line. Then check every ingredient and quantity before approval.</p>
          <button className={styles.primaryButton} type="button" onClick={openCreate}>
            <Plus aria-hidden="true" /> Add menu
          </button>
        </section>
      ) : (
        <section className={styles.menuGrid} aria-label="Restaurant menus">
          {menus.map((menu) => (
            <button
              className={styles.menuCard}
              type="button"
              key={menu.id}
              onClick={() => router.push(`/menus/${encodeURIComponent(menu.id)}`)}
            >
              <span className={styles.cardTop}>
                <span className={menu.status === 'APPROVED' ? styles.approved : styles.draft}>
                  {menu.status === 'APPROVED' ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
                  {menu.status === 'APPROVED' ? 'Approved' : 'Needs review'}
                </span>
                <span>Version {menu.version}</span>
              </span>
              <strong>{menu.name}</strong>
              <span className={styles.cardMeta}>
                {menu.status === 'APPROVED'
                  ? 'Ready to use in a request'
                  : 'Open and check the ingredient list'}
              </span>
              <span className={styles.cardBottom}>
                Updated {formatUpdated(menu.updatedAt)}
                <ArrowRight aria-hidden="true" />
              </span>
            </button>
          ))}
        </section>
      )}

      {nextCursor && !loading && (
        <button
          className={styles.loadMore}
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMenus(nextCursor)}
        >
          {loadingMore ? 'Loading more…' : 'Load more menus'}
        </button>
      )}

      {createOpen && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !saving) setCreateOpen(false);
        }}>
          <section className={styles.dialog} ref={createDialog} role="dialog" aria-modal="true" aria-labelledby="new-menu-title">
            <header>
              <div>
                <p className={styles.eyebrow}>New menu</p>
                <h2 id="new-menu-title">Paste your dish names</h2>
              </div>
              <button type="button" aria-label="Close menu form" disabled={saving} onClick={() => setCreateOpen(false)}><X /></button>
            </header>
            <form onSubmit={createDraft}>
              {createError && <div className={styles.dialogError} role="alert">{createError}</div>}
              <label htmlFor="menu-dishes">One dish per line</label>
              <textarea
                id="menu-dishes"
                rows={12}
                maxLength={100_000}
                value={menuText}
                onChange={(event) => setMenuText(event.target.value)}
                placeholder={'Paneer tikka\nDal makhani\nJeera rice\nTandoori roti'}
              />
              <p>We only create dish names. You will add and check the ingredients on the next screen.</p>
              <footer>
                <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => setCreateOpen(false)}>Cancel</button>
                <button className={styles.primaryButton} type="submit" disabled={saving || !menuText.trim()}>
                  {saving ? 'Saving draft…' : 'Save and review'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
