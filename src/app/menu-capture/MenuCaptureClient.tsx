'use client';

import { Camera, CheckCircle2, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import {
  PhotoTransferClientError,
  consumeCurrentPhoneTransferFragment,
  readBrowserImageDimensions,
  sendPhonePhotoBatch,
  type PhoneTransferSession,
} from '@/lib/menu/photo-transfer-client';
import {
  mergeMenuPhotoFiles,
  validateMenuPhotoSelection,
} from '@/lib/menu/photo-intake';

import styles from './menu-capture.module.css';

type PhonePhoto = { file: File; previewUrl: string };

export function MenuCaptureClient() {
  const [session, setSession] = useState<PhoneTransferSession | null>(null);
  const [linkState, setLinkState] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [photos, setPhotos] = useState<PhonePhoto[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [batchLocked, setBatchLocked] = useState(false);
  const [sent, setSent] = useState(false);
  const [progress, setProgress] = useState('');
  const urls = useRef<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const sessionPromise = useRef<Promise<PhoneTransferSession> | null>(null);
  const sessionRef = useRef<PhoneTransferSession | null>(null);
  const batchLockedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const settleSession = (pending: Promise<PhoneTransferSession>) => {
      void pending.then((next) => {
        if (cancelled) return;
        if (sessionPromise.current !== pending) return;
        sessionRef.current = next;
        setSession(next);
        setLinkState('ready');
      }).catch(() => {
        if (cancelled) return;
        if (sessionPromise.current !== pending) return;
        sessionRef.current = null;
        setSession(null);
        setLinkState('invalid');
      });
    };
    const pending = sessionPromise.current ??= consumeCurrentPhoneTransferFragment();
    settleSession(pending);

    const onHashChange = () => {
      controller.current?.abort();
      controller.current = null;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current = [];
      batchLockedRef.current = false;
      sessionRef.current = null;
      setSession(null);
      setPhotos([]);
      setSent(false);
      setError('');
      setProgress('');
      setSending(false);
      setBatchLocked(false);
      setLinkState('checking');
      sessionPromise.current = consumeCurrentPhoneTransferFragment();
      settleSession(sessionPromise.current);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  useEffect(() => () => {
    controller.current?.abort();
    urls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function replacePhotos(nextFiles: readonly File[]) {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    const next = nextFiles.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    urls.current = next.map(({ previewUrl }) => previewUrl);
    setPhotos(next);
  }

  async function selectPhotos(files: FileList | null) {
    if (!files || sending || batchLockedRef.current) return;
    const activeSessionPromise = sessionPromise.current;
    setError('');
    try {
      const checked = await validateMenuPhotoSelection(
        mergeMenuPhotoFiles(photos.map(({ file }) => file), [...files]),
        readBrowserImageDimensions,
      );
      if (batchLockedRef.current) return;
      if (sessionPromise.current !== activeSessionPromise) return;
      replacePhotos(checked);
    } catch (caught) {
      if (sessionPromise.current !== activeSessionPromise) return;
      setError(caught instanceof Error ? caught.message : 'These photos could not be used.');
    }
  }

  function removePhoto(index: number) {
    if (batchLockedRef.current) return;
    replacePhotos(photos.filter((_, current) => current !== index).map(({ file }) => file));
    setError('');
  }

  async function sendPhotos() {
    if (!session || photos.length === 0 || sending) return;
    const activeSession = session;
    const nextController = new AbortController();
    controller.current = nextController;
    batchLockedRef.current = true;
    setBatchLocked(true);
    setSending(true);
    setError('');
    const isCurrentSend = () => (
      sessionRef.current === activeSession && controller.current === nextController
    );
    try {
      await sendPhonePhotoBatch({
        files: photos.map(({ file }) => file),
        token: session.token,
        key: session.key,
        readDimensions: readBrowserImageDimensions,
        onProgress: ({ message }) => {
          if (!isCurrentSend()) return;
          setProgress(message);
        },
        signal: nextController.signal,
      });
      if (!isCurrentSend()) return;
      setSent(true);
      setProgress('');
    } catch (caught) {
      if (!isCurrentSend()) return;
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (caught instanceof PhotoTransferClientError && caught.status === 410) {
        setLinkState('invalid');
        return;
      }
      setError(caught instanceof Error
        ? caught.message
        : 'The photos could not be sent. Check your connection and try again.');
    } finally {
      if (isCurrentSend()) {
        controller.current = null;
        setSending(false);
      }
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.brand}><Wordmark /></header>
      <section className={styles.card} aria-labelledby="capture-title">
        {linkState === 'checking' && (
          <div className={styles.centered} role="status">
            <LoaderCircle className={styles.spin} aria-hidden="true" />
            <h1 id="capture-title">Opening the camera</h1>
            <p>Checking this private photo code…</p>
          </div>
        )}

        {linkState === 'invalid' && (
          <div className={styles.centered} role="alert">
            <Camera aria-hidden="true" />
            <h1 id="capture-title">This code is no longer ready</h1>
            <p>Ask the laptop to make a new code.</p>
          </div>
        )}

        {linkState === 'ready' && sent && (
          <div className={styles.centered} role="status" aria-live="polite">
            <CheckCircle2 className={styles.successIcon} aria-hidden="true" />
            <h1 id="capture-title">Photos sent</h1>
            <p>They were sent securely. The laptop will collect them automatically. You can close this page.</p>
          </div>
        )}

        {linkState === 'ready' && !sent && (
          <>
            <div className={styles.heading}>
              <p>Menu photo handoff</p>
              <h1 id="capture-title">Take or choose up to 10 photos</h1>
              <span>Use clear, straight photos. You can add them in more than one go.</span>
            </div>

            <label className={styles.picker} htmlFor="phone-menu-photos">
              <Camera aria-hidden="true" />
              <strong>Take photos or choose images</strong>
              <span>{photos.length} of 10 selected</span>
            </label>
            <input
              className={styles.hiddenInput}
              id="phone-menu-photos"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              disabled={batchLocked || sending || photos.length >= 10}
              onChange={(event) => {
                void selectPhotos(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />

            {photos.length > 0 && (
              <div className={styles.previewGrid} aria-label="Selected photos">
                {photos.map((photo, index) => (
                  <figure key={photo.previewUrl}>
                    {/* Object URLs stay on this phone and are revoked on replacement or close. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.previewUrl} alt={`Menu photo ${index + 1}`} />
                    <button
                      type="button"
                      disabled={batchLocked || sending}
                      aria-label={`Remove photo ${index + 1}`}
                      onClick={() => removePhoto(index)}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </figure>
                ))}
              </div>
            )}

            {error && <p className={styles.error} role="alert">{error}</p>}
            {batchLocked && !sent && (
              <p className={styles.locked} role="note">
                This code is now tied to the selected photos. To change these photos, scan a new code from the laptop.
              </p>
            )}
            {sending && (
              <p
                className={styles.progress}
                role="status"
                aria-label="Sending photo progress"
                aria-live="polite"
              >
                <LoaderCircle className={styles.spin} aria-hidden="true" />
                {progress || 'Preparing your photos…'}
              </p>
            )}

            <button
              className={styles.done}
              type="button"
              disabled={photos.length === 0 || sending}
              onClick={() => void sendPhotos()}
            >
              {sending ? 'Sending…' : batchLocked ? 'Try sending again' : 'Done'}
            </button>

            <div className={styles.privacy}>
              <ShieldCheck aria-hidden="true" />
              <p>Your photos are encrypted on this phone, held temporarily for the handoff, and can only be opened by the laptop that made this code.</p>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
