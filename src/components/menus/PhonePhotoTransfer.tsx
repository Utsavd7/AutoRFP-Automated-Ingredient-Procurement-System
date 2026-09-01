'use client';

import {
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  deleteLocalMenuPhotoBatch,
  listLocalMenuPhotoBatches,
  saveLocalMenuPhotoBatch,
  type LocalMenuPhotoBatch,
} from '@/lib/menu/local-menu-photos';
import {
  LocalPhotoPersistenceError,
  PhotoTransferClientError,
  PhotoTransferReceiptError,
  createLaptopPhotoTransfer,
  getLaptopPhotoTransferStatus,
  readBrowserImageDimensions,
  receiveLaptopPhotoTransfer,
  type LaptopPhotoTransfer,
} from '@/lib/menu/photo-transfer-client';

import styles from './phone-photo-transfer.module.css';

type TransferStage = 'idle' | 'waiting' | 'receiving' | 'saved' | 'error' | 'expired';

function formatExpiry(expiresAt: number) {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(expiresAt));
}

function transferErrorMessage(caught: unknown) {
  if (caught instanceof PhotoTransferClientError && caught.status === 410) {
    return 'This code has expired. Make a fresh code and scan again.';
  }
  return caught instanceof Error
    ? caught.message
    : 'The phone transfer stopped. Check the connection and scan again.';
}

export function PhonePhotoTransfer({
  workspaceId,
  currentPhotoCount,
  onReceived,
  onGalleryChanged,
}: {
  workspaceId: string;
  currentPhotoCount: number;
  onReceived: (batchId: string | undefined, files: File[]) => void;
  onGalleryChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [session, setSession] = useState<LaptopPhotoTransfer | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [stage, setStage] = useState<TransferStage>('idle');
  const [receivedCount, setReceivedCount] = useState(0);
  const [message, setMessage] = useState('');
  const [temporaryFiles, setTemporaryFiles] = useState<File[]>([]);
  const [temporaryUrls, setTemporaryUrls] = useState<string[]>([]);
  const temporaryUrlRef = useRef<string[]>([]);
  const createController = useRef<AbortController | null>(null);
  const onReceivedRef = useRef(onReceived);
  const onGalleryChangedRef = useRef(onGalleryChanged);
  const currentPhotoCountRef = useRef(currentPhotoCount);

  useEffect(() => { onReceivedRef.current = onReceived; }, [onReceived]);
  useEffect(() => { onGalleryChangedRef.current = onGalleryChanged; }, [onGalleryChanged]);
  useEffect(() => { currentPhotoCountRef.current = currentPhotoCount; }, [currentPhotoCount]);

  useEffect(() => () => {
    createController.current?.abort();
    temporaryUrlRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function replaceTemporaryFiles(files: File[]) {
    temporaryUrlRef.current.forEach((url) => URL.revokeObjectURL(url));
    const urls = files.map((file) => URL.createObjectURL(file));
    temporaryUrlRef.current = urls;
    setTemporaryFiles(files);
    setTemporaryUrls(urls);
  }

  async function startTransfer() {
    createController.current?.abort();
    const controller = new AbortController();
    createController.current = controller;
    setOpen(true);
    setCreating(true);
    setSession(null);
    setQrImage('');
    setStage('idle');
    setMessage('');
    setReceivedCount(0);
    replaceTemporaryFiles([]);
    try {
      if (!workspaceId) throw new Error('The restaurant workspace is not ready yet.');
      const created = await createLaptopPhotoTransfer({
        origin: window.location.origin,
        signal: controller.signal,
      });
      const QRCode = (await import('qrcode')).default;
      const image = await QRCode.toDataURL(created.captureUrl, {
        width: 248,
        margin: 1,
        color: { dark: '#101817', light: '#fffdf8' },
        errorCorrectionLevel: 'M',
      });
      if (controller.signal.aborted) return;
      setSession(created);
      setQrImage(image);
      setStage('waiting');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setStage('error');
      setMessage(transferErrorMessage(caught));
    } finally {
      if (createController.current === controller) createController.current = null;
      setCreating(false);
    }
  }

  function closeTransfer() {
    createController.current?.abort();
    setOpen(false);
    setSession(null);
    setQrImage('');
    replaceTemporaryFiles([]);
  }

  useEffect(() => {
    if (!open || !session) return;
    let stopped = false;
    let busy = false;
    let timer: number | null = null;
    let activeController: AbortController | null = null;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      if (stopped || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void poll();
      }, 2_000);
    };
    const poll = async () => {
      if (stopped || busy) return;
      if (document.visibilityState !== 'visible') return;
      busy = true;
      const controller = new AbortController();
      activeController = controller;
      try {
        const status = await getLaptopPhotoTransferStatus({
          token: session.token,
          signal: controller.signal,
        });
        if (stopped) return;
        setReceivedCount(status.files.length);
        if (status.status === 'waiting') {
          schedule();
          return;
        }

        setStage('receiving');
        const received = await receiveLaptopPhotoTransfer({
          token: session.token,
          key: session.key,
          workspaceId,
          metadata: status.files,
          readDimensions: readBrowserImageDimensions,
          saveBatch: saveLocalMenuPhotoBatch,
          signal: controller.signal,
        });
        if (stopped) return;
        onGalleryChangedRef.current();
        if (currentPhotoCountRef.current + received.files.length <= 10) {
          onReceivedRef.current(received.batchId, received.files);
          setMessage('Photos received, saved on this laptop, and added above.');
        } else {
          setMessage('Photos received and saved on this laptop for later. Your current selection already has too many photos to add this batch.');
        }
        setStage('saved');
        stopped = true;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        if (caught instanceof PhotoTransferReceiptError) {
          onGalleryChangedRef.current();
          if (currentPhotoCountRef.current + caught.files.length <= 10) {
            onReceivedRef.current(caught.batchId, caught.files);
          }
          setMessage(caught.message);
          setStage('saved');
          stopped = true;
          return;
        }
        if (caught instanceof LocalPhotoPersistenceError) {
          replaceTemporaryFiles(caught.files);
          if (currentPhotoCountRef.current + caught.files.length <= 10) {
            onReceivedRef.current(undefined, caught.files);
          }
          setMessage('The photos arrived and remain available in this open panel, but this browser could not save them on this laptop. Temporary server copies may expire.');
          setStage('error');
          stopped = true;
          return;
        }
        const expired = caught instanceof PhotoTransferClientError && caught.status === 410;
        setMessage(transferErrorMessage(caught));
        setStage(expired ? 'expired' : 'error');
        stopped = true;
      } finally {
        busy = false;
        if (activeController === controller) activeController = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !busy && !stopped) {
        clearTimer();
        void poll();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      clearTimer();
      activeController?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [open, session, workspaceId]);

  return (
    <div className={styles.phoneOption}>
      <button type="button" onClick={() => void startTransfer()}>
        <MonitorSmartphone aria-hidden="true" />
        <span>
          <strong>Use your phone</strong>
          <small>Scan with your phone. Take up to 10 photos. They arrive here automatically.</small>
        </span>
      </button>

      {open && (
        <section className={styles.panel} aria-label="Send menu photos from a phone">
          <header>
            <div>
              <strong>Phone photo handoff</strong>
              <span>No sign-in is needed on the phone.</span>
            </div>
            <button type="button" aria-label="Close phone transfer" onClick={closeTransfer}>
              <X aria-hidden="true" />
            </button>
          </header>

          {creating && (
            <p className={styles.status} role="status">
              <LoaderCircle className={styles.spin} aria-hidden="true" /> Making a private code…
            </p>
          )}

          {session && qrImage && stage !== 'saved' && (
            <div className={styles.qrArea}>
              {/* The data URL encodes fragment-only token and AES key material. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImage} alt="Private code for sending menu photos from a phone" />
              <div>
                <p>Scan with your phone. Take up to 10 photos. They arrive here automatically.</p>
                <span><Clock3 aria-hidden="true" /> Code expires at {formatExpiry(session.expiresAt)}</span>
              </div>
            </div>
          )}

          {stage === 'waiting' && (
            <p className={styles.status} role="status" aria-live="polite">
              <LoaderCircle className={styles.spin} aria-hidden="true" />
              Waiting for the phone · {receivedCount} {receivedCount === 1 ? 'photo' : 'photos'} received
            </p>
          )}
          {stage === 'receiving' && (
            <p className={styles.status} role="status" aria-live="polite">
              <LoaderCircle className={styles.spin} aria-hidden="true" /> Opening and saving the photos on this laptop…
            </p>
          )}
          {stage === 'saved' && (
            <p className={styles.saved} role="status" aria-live="polite">
              <CheckCircle2 aria-hidden="true" /> {message}
            </p>
          )}
          {(stage === 'error' || stage === 'expired') && message && (
            <p className={styles.error} role="alert">{message}</p>
          )}

          {temporaryFiles.length > 0 && (
            <div className={styles.temporaryGrid} aria-label="Photos available while this panel stays open">
              {temporaryFiles.map((file, index) => (
                <figure key={`${file.name}-${index}`}>
                  {/* Live-only object URLs are revoked when this panel closes. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={temporaryUrls[index]} alt={`Received menu photo ${index + 1}`} />
                </figure>
              ))}
            </div>
          )}

          {(stage === 'saved' || stage === 'error' || stage === 'expired') && (
            <button className={styles.scanAgain} type="button" onClick={() => void startTransfer()}>
              <RefreshCw aria-hidden="true" /> Scan again
            </button>
          )}

          <div className={styles.privacy}>
            <ShieldCheck aria-hidden="true" />
            <p>Phone photos are encrypted before upload, held temporarily for this handoff, then the original files are kept only in this laptop&apos;s browser after they arrive.</p>
          </div>
        </section>
      )}
    </div>
  );
}

type GalleryView = LocalMenuPhotoBatch & { previewUrls: string[] };

function formatBatchDate(value: number) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function LocalMenuPhotoGallery({
  workspaceId,
  refreshKey,
}: {
  workspaceId: string;
  refreshKey: number;
}) {
  const [batches, setBatches] = useState<GalleryView[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    const urls: string[] = [];
    void listLocalMenuPhotoBatches(workspaceId)
      .then((loaded) => {
        if (!active) return;
        setError('');
        setBatches(loaded.map((batch) => ({
          ...batch,
          previewUrls: batch.photos.map(({ blob }) => {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            return url;
          }),
        })));
      })
      .catch(() => {
        if (active) setError('This browser cannot show photos saved on this laptop right now.');
      });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [workspaceId, refreshKey, reload]);

  async function removeBatch(batchId: string) {
    if (!window.confirm('Remove this photo batch from this laptop?')) return;
    try {
      await deleteLocalMenuPhotoBatch(workspaceId, batchId);
      setReload((value) => value + 1);
    } catch {
      setError('This photo batch could not be removed from this laptop.');
    }
  }

  return (
    <section className={styles.gallery} aria-labelledby="local-photo-gallery-title">
      <header>
        <div>
          <p>Local photo shelf</p>
          <h2 id="local-photo-gallery-title">Photos on this laptop</h2>
        </div>
        <span>Private to this browser</span>
      </header>
      {error && <p className={styles.galleryError} role="alert">{error}</p>}
      {!error && batches.length === 0 && (
        <p className={styles.galleryEmpty}>Phone photo batches saved here will appear in this private shelf.</p>
      )}
      {batches.length > 0 && (
        <div className={styles.batchList}>
          {batches.map((batch) => (
            <article key={batch.batchId}>
              <div className={styles.batchPhotos} aria-label={`${batch.photos.length} saved menu photos`}>
                {batch.previewUrls.slice(0, 4).map((url, index) => (
                  // IndexedDB Blob previews are revoked whenever this gallery reloads.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={`Saved menu photo ${index + 1}`} key={url} />
                ))}
                {batch.photos.length > 4 && <span>+{batch.photos.length - 4}</span>}
              </div>
              <div className={styles.batchMeta}>
                <strong>{batch.photos.length} {batch.photos.length === 1 ? 'photo' : 'photos'}</strong>
                <span>{formatBatchDate(batch.createdAt)}</span>
                {batch.menuId && <small>Linked to a saved menu</small>}
              </div>
              <button type="button" onClick={() => void removeBatch(batch.batchId)}>
                <Trash2 aria-hidden="true" /> Remove from this laptop
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
