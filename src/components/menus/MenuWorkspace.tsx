'use client';

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock3,
  FileText,
  Globe2,
  LoaderCircle,
  MonitorSmartphone,
  Plus,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildReviewedOcrMenuInput,
  mergeMenuPhotoFiles,
  photoIntakeModeFromSearch,
  validateMenuPhotoSelection,
} from '@/lib/menu/photo-intake';

import styles from './menu-workspace.module.css';

type MenuSummary = {
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

type IntakeMode = 'text' | 'photo' | 'url';

type PhotoPreview = {
  file: File;
  previewUrl: string;
};

async function readImageDimensions(file: File) {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  const previewUrl = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      image.onerror = () => reject(new Error(`${file.name} could not be read as an image.`));
      image.src = previewUrl;
    });
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

export function MenuIntakeDialog({
  initialMode,
  onClose,
  onCreated,
}: {
  initialMode?: IntakeMode;
  onClose: () => void;
  onCreated: (menuId: string) => void;
}) {
  const [mode, setMode] = useState<IntakeMode | null>(initialMode ?? null);
  const [menuText, setMenuText] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const [photos, setPhotos] = useState<PhotoPreview[]>([]);
  const [readingPhotos, setReadingPhotos] = useState(false);
  const [cancellingPhotos, setCancellingPhotos] = useState(false);
  const [photoReady, setPhotoReady] = useState(false);
  const [confidences, setConfidences] = useState<number[]>([]);
  const [photoProgress, setPhotoProgress] = useState({
    image: 0,
    total: 0,
    progress: 0,
    status: '',
  });
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websitePermission, setWebsitePermission] = useState(false);
  const [importingWebsite, setImportingWebsite] = useState(false);
  const [canonicalWebsiteUrl, setCanonicalWebsiteUrl] = useState('');
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneQr, setPhoneQr] = useState('');
  const [phoneQrLoading, setPhoneQrLoading] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const photoController = useRef<AbortController | null>(null);
  const photoUrls = useRef<string[]>([]);
  const busy = saving || readingPhotos || importingWebsite;
  const busyRef = useRef(busy);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
    ) ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onClose();
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
  }, [onClose]);

  useEffect(() => () => {
    photoController.current?.abort();
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function replacePhotos(files: readonly File[]) {
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const next = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    photoUrls.current = next.map((photo) => photo.previewUrl);
    setPhotos(next);
  }

  function clearPhotos() {
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
    photoUrls.current = [];
    setPhotos([]);
  }

  async function selectPhotos(files: FileList | null) {
    if (!files) return;
    setCreateError('');
    setPhotoReady(false);
    setMenuText('');
    setConfidences([]);
    try {
      const checked = await validateMenuPhotoSelection(
        mergeMenuPhotoFiles(photos.map(({ file }) => file), [...files]),
        readImageDimensions,
      );
      replacePhotos(checked);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'These photos could not be used.');
    }
  }

  function removePhoto(index: number) {
    replacePhotos(photos.filter((_, current) => current !== index).map(({ file }) => file));
    setPhotoReady(false);
    setMenuText('');
    setConfidences([]);
  }

  async function readPhotos() {
    if (readingPhotos || photos.length === 0) return;
    setCreateError('');
    setPhotoReady(false);
    setReadingPhotos(true);
    setCancellingPhotos(false);
    const controller = new AbortController();
    photoController.current = controller;
    try {
      const { recognizeMenuPhotos } = await import('@/lib/menu/browser-ocr');
      const result = await recognizeMenuPhotos(
        photos.map((photo) => photo.file),
        {
          signal: controller.signal,
          onProgress: setPhotoProgress,
        },
      );
      if (!result.text.trim()) {
        throw new Error('No menu text was found. Try a clearer photo or type the dish names.');
      }
      setMenuText(result.text);
      setConfidences(result.confidences);
      setPhotoReady(true);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setCreateError(caught instanceof Error
          ? caught.message
          : 'The photos could not be read on this device.');
      }
    } finally {
      if (photoController.current === controller) photoController.current = null;
      setReadingPhotos(false);
      setCancellingPhotos(false);
    }
  }

  function cancelPhotoReading() {
    setCancellingPhotos(true);
    photoController.current?.abort();
  }

  async function importWebsiteText() {
    if (!websiteUrl.trim() || !websitePermission || importingWebsite) return;
    setImportingWebsite(true);
    setCreateError('');
    try {
      const response = await fetch('/api/menu-import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: websiteUrl.trim(),
          permissionConfirmed: true,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, 'We could not import this menu link.'));
      }
      const result = (await response.json()) as {
        menuText?: string;
        canonicalUrl?: string;
      };
      if (!result.menuText || !result.canonicalUrl) {
        throw new Error('The menu text was not returned.');
      }
      setMenuText(result.menuText);
      setCanonicalWebsiteUrl(result.canonicalUrl);
    } catch (caught) {
      setCreateError(caught instanceof Error
        ? caught.message
        : 'We could not import this menu link.');
    } finally {
      setImportingWebsite(false);
    }
  }

  async function showPhoneQr() {
    if (phoneQr || phoneQrLoading) {
      setPhoneOpen(true);
      return;
    }
    setPhoneOpen(true);
    setPhoneQrLoading(true);
    setCreateError('');
    try {
      const target = new URL(window.location.href);
      target.searchParams.set('menuIntake', 'photo');
      target.hash = '';
      const QRCode = (await import('qrcode')).default;
      setPhoneQr(await QRCode.toDataURL(target.toString(), {
        width: 224,
        margin: 1,
        color: { dark: '#101817', light: '#fffdf8' },
      }));
    } catch {
      setCreateError('We could not prepare the phone code. Try again.');
    } finally {
      setPhoneQrLoading(false);
    }
  }

  async function saveMenu(input: unknown) {
    if (saving) return;
    setSaving(true);
    setCreateError('');
    try {
      const response = await fetch('/api/parse-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, 'We could not save this menu draft.'));
      }
      const result = (await response.json()) as { menuId?: string };
      if (!result.menuId) throw new Error('The menu draft was not returned.');
      onCreated(result.menuId);
    } catch (caught) {
      setCreateError(caught instanceof Error
        ? caught.message
        : 'We could not save this menu draft.');
      setSaving(false);
    }
  }

  function backToChoices() {
    if (busy) return;
    setCreateError('');
    setMode(null);
  }

  const titles: Record<IntakeMode, string> = {
    text: 'Type or paste dish names',
    photo: 'Add menu photos',
    url: 'Import a permitted menu link',
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section
        className={styles.dialog}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-menu-title"
      >
        <header>
          <div>
            <p className={styles.eyebrow}>New menu</p>
            <h2 id="new-menu-title">{mode ? titles[mode] : 'How would you like to add it?'}</h2>
          </div>
          <button type="button" aria-label="Close menu form" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>

        <div className={styles.dialogBody}>
          {createError && <div className={styles.dialogError} role="alert">{createError}</div>}

          {!mode && (
            <div className={styles.intakeChoices}>
              <button type="button" onClick={() => setMode('text')}>
                <FileText aria-hidden="true" />
                <span><strong>Type or paste</strong><small>Enter dish names as text</small></span>
                <ArrowRight aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setMode('photo')}>
                <Camera aria-hidden="true" />
                <span><strong>Photos</strong><small>Use your camera or upload images</small></span>
                <ArrowRight aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setMode('url')}>
                <Globe2 aria-hidden="true" />
                <span><strong>Permitted website link</strong><small>Import text from a menu page you can use</small></span>
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          )}

          {mode === 'text' && (
            <form onSubmit={(event) => {
              event.preventDefault();
              if (menuText.trim()) void saveMenu({ menuText });
            }}>
              <button className={styles.backButton} type="button" onClick={backToChoices}>
                <ArrowLeft aria-hidden="true" /> All options
              </button>
              <label htmlFor="menu-dishes">One dish per line</label>
              <textarea
                id="menu-dishes"
                rows={12}
                maxLength={100_000}
                value={menuText}
                onChange={(event) => setMenuText(event.target.value)}
                placeholder={'Paneer tikka\nDal makhani\nJeera rice\nTandoori roti'}
              />
              <p>We create dish names only. You will add and check ingredients on the next screen.</p>
              <footer>
                <button className={styles.secondaryButton} type="button" disabled={saving} onClick={onClose}>Cancel</button>
                <button className={styles.primaryButton} type="submit" disabled={saving || !menuText.trim()}>
                  {saving ? 'Saving draft…' : 'Save and review'}
                </button>
              </footer>
            </form>
          )}

          {mode === 'photo' && (
            <div className={styles.intakePanel}>
              <button className={styles.backButton} type="button" disabled={busy} onClick={backToChoices}>
                <ArrowLeft aria-hidden="true" /> All options
              </button>
              <div className={styles.privacyNote}>
                <ShieldCheck aria-hidden="true" />
                <p><strong>Your photos stay on this device.</strong> They are read in your browser and are never uploaded or saved.</p>
              </div>

              {!photoReady && !readingPhotos && (
                <>
                  <label className={styles.photoPicker} htmlFor="menu-photos">
                    <Upload aria-hidden="true" />
                    <strong>Take photos or choose images</strong>
                    <span>Choose up to 5 clear JPG, PNG, or WebP images</span>
                  </label>
                  <input
                    className={styles.hiddenInput}
                    id="menu-photos"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={(event) => {
                      void selectPhotos(event.target.files);
                      event.currentTarget.value = '';
                    }}
                  />
                </>
              )}

              {photos.length > 0 && !photoReady && !readingPhotos && (
                <>
                  <div className={styles.photoStrip} aria-label="Selected menu photos">
                    {photos.map((photo, index) => (
                      <figure key={photo.previewUrl}>
                        {/* Browser object URLs are local previews and are revoked on replacement or close. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.previewUrl} alt={`Menu photo ${index + 1}`} />
                        <figcaption>{index + 1}</figcaption>
                        <button
                          type="button"
                          aria-label={`Remove menu photo ${index + 1}`}
                          onClick={() => removePhoto(index)}
                        >
                          <X aria-hidden="true" />
                        </button>
                      </figure>
                    ))}
                  </div>
                  <button className={styles.primaryButton} type="button" onClick={() => void readPhotos()}>
                    Read {photos.length === 1 ? 'photo' : `${photos.length} photos`}
                  </button>
                </>
              )}

              {readingPhotos && (
                <div className={styles.photoProgress} role="status" aria-live="polite">
                  <LoaderCircle aria-hidden="true" />
                  <div>
                    <strong>{cancellingPhotos ? 'Stopping photo reading' : photoProgress.status}</strong>
                    <span>{photoProgress.image > 0
                      ? `Photo ${photoProgress.image} of ${photoProgress.total}`
                      : 'Loading the local reader'}</span>
                    <progress max={1} value={photoProgress.progress} />
                  </div>
                  <button type="button" disabled={cancellingPhotos} onClick={cancelPhotoReading}>
                    {cancellingPhotos ? 'Stopping…' : 'Cancel'}
                  </button>
                </div>
              )}

              {photoReady && (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const input = buildReviewedOcrMenuInput(menuText, confidences);
                  if (input.menuText) void saveMenu(input);
                }}>
                  <label htmlFor="reviewed-photo-text">Check the text before saving</label>
                  <textarea
                    id="reviewed-photo-text"
                    rows={12}
                    maxLength={100_000}
                    value={menuText}
                    onChange={(event) => setMenuText(event.target.value)}
                  />
                  <p>Correct any missed words and keep one dish per line.</p>
                  <footer>
                    <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => {
                      clearPhotos();
                      setPhotoReady(false);
                      setMenuText('');
                      setConfidences([]);
                    }}>Choose again</button>
                    <button className={styles.primaryButton} type="submit" disabled={saving || !menuText.trim()}>
                      {saving ? 'Saving draft…' : 'Save and review'}
                    </button>
                  </footer>
                </form>
              )}

              <div className={styles.phoneOption}>
                <button type="button" onClick={() => void showPhoneQr()}>
                  <MonitorSmartphone aria-hidden="true" />
                  <span><strong>Use your phone</strong><small>Open photo mode on a phone</small></span>
                </button>
                {phoneOpen && (
                  <div className={styles.phoneQr}>
                    {phoneQrLoading ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : phoneQr && (
                      // The QR contains only this authenticated app URL.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={phoneQr} alt="Code to open menu photos on your phone" />
                    )}
                    <p>Scan this with a phone signed in to the same restaurant account. Refresh this page after the phone saves the menu.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {mode === 'url' && (
            <div className={styles.intakePanel}>
              <button className={styles.backButton} type="button" disabled={busy} onClick={backToChoices}>
                <ArrowLeft aria-hidden="true" /> All options
              </button>
              {!canonicalWebsiteUrl ? (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  void importWebsiteText();
                }}>
                  <label htmlFor="menu-website">Menu website address</label>
                  <input
                    id="menu-website"
                    type="url"
                    inputMode="url"
                    maxLength={2_048}
                    value={websiteUrl}
                    onChange={(event) => setWebsiteUrl(event.target.value)}
                    placeholder="https://restaurant.example/menu"
                  />
                  <label className={styles.permissionCheck}>
                    <input
                      type="checkbox"
                      checked={websitePermission}
                      onChange={(event) => setWebsitePermission(event.target.checked)}
                    />
                    <span><strong>I have permission to use this menu</strong><small>Only import a page owned by your restaurant or one you are allowed to use.</small></span>
                  </label>
                  <footer>
                    <button className={styles.secondaryButton} type="button" disabled={importingWebsite} onClick={onClose}>Cancel</button>
                    <button className={styles.primaryButton} type="submit" disabled={importingWebsite || !websitePermission || !websiteUrl.trim()}>
                      {importingWebsite ? 'Importing text…' : 'Import menu text'}
                    </button>
                  </footer>
                </form>
              ) : (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  if (!menuText.trim()) return;
                  void saveMenu({
                    menuText,
                    source: {
                      kind: 'PERMITTED_URL',
                      canonicalUrl: canonicalWebsiteUrl,
                      permissionConfirmed: true,
                    },
                  });
                }}>
                  <div className={styles.importedFrom}><CheckCircle2 aria-hidden="true" /> Text imported from the permitted page</div>
                  <label htmlFor="reviewed-website-text">Check the text before saving</label>
                  <textarea
                    id="reviewed-website-text"
                    rows={12}
                    maxLength={100_000}
                    value={menuText}
                    onChange={(event) => setMenuText(event.target.value)}
                  />
                  <p>Remove page headings and keep one dish per line.</p>
                  <footer>
                    <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => {
                      setCanonicalWebsiteUrl('');
                      setMenuText('');
                    }}>Use a different link</button>
                    <button className={styles.primaryButton} type="submit" disabled={saving || !menuText.trim()}>
                      {saving ? 'Saving draft…' : 'Save and review'}
                    </button>
                  </footer>
                </form>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
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
  const [initialCreateMode, setInitialCreateMode] = useState<IntakeMode | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const initialLoadStarted = useRef(false);

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
    const timer = window.setTimeout(() => {
      const queryMode = photoIntakeModeFromSearch(window.location.search);
      if (queryMode) {
        setInitialCreateMode(queryMode);
        setCreateOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function openCreate() {
    setInitialCreateMode(undefined);
    setCreateOpen(true);
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
        <MenuIntakeDialog
          initialMode={initialCreateMode}
          onClose={() => setCreateOpen(false)}
          onCreated={(menuId) => router.push(`/menus/${encodeURIComponent(menuId)}`)}
        />
      )}
    </main>
  );
}
