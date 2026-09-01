import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { MenuCaptureClient } from '@/app/menu-capture/MenuCaptureClient';
import {
  LocalMenuPhotoGallery,
  PhonePhotoTransfer,
} from '@/components/menus/PhonePhotoTransfer';

const root = path.resolve(__dirname, '../..');

describe('phone menu photo transfer UI contracts', () => {
  it('has a mobile capture input, repeated selection, removal, and accessible outcome copy', () => {
    const capture = readFileSync(path.join(root, 'src/app/menu-capture/MenuCaptureClient.tsx'), 'utf8');
    const html = renderToStaticMarkup(<MenuCaptureClient />);

    expect(capture).toContain('accept="image/*"');
    expect(capture).toContain('capture="environment"');
    expect(capture).toContain('multiple');
    expect(capture).toContain('up to 10');
    expect(capture).toContain('Remove photo');
    expect(capture).toContain('Sending photo');
    expect(capture).toContain('Photos sent');
    expect(capture).toContain('You can close this page');
    expect(capture).toContain('Ask the laptop to make a new code.');
    expect(html).toContain('QuotePlate');
    const route = readFileSync(path.join(root, 'src/app/menu-capture/page.tsx'), 'utf8');
    expect(route).toContain('index: false');
    expect(route).toContain('follow: false');
  });

  it('resolves the fragment reliably across the StrictMode effect replay', () => {
    const capture = readFileSync(
      path.join(root, 'src/app/menu-capture/MenuCaptureClient.tsx'),
      'utf8',
    );

    expect(capture).toContain('sessionPromise.current ??= consumeCurrentPhoneTransferFragment()');
    expect(capture).toContain('let cancelled = false');
    expect(capture).toContain('if (cancelled) return');
    expect(capture).not.toContain('linkRead.current');
  });

  it('locks the exact selected batch after sending begins and requires a new code to change it', () => {
    const capture = readFileSync(
      path.join(root, 'src/app/menu-capture/MenuCaptureClient.tsx'),
      'utf8',
    );

    expect(capture).toContain("const [batchLocked, setBatchLocked] = useState(false)");
    expect(capture).toContain('const batchLockedRef = useRef(false)');
    expect(capture).toContain('batchLockedRef.current = true');
    expect(capture).toContain('if (batchLockedRef.current) return');
    expect(capture.indexOf('setBatchLocked(true)')).toBeLessThan(
      capture.indexOf('await sendPhonePhotoBatch'),
    );
    expect(capture).toContain('disabled={batchLocked || sending || photos.length >= 10}');
    expect(capture).toContain('disabled={batchLocked || sending}');
    expect(capture).toContain('To change these photos, scan a new code from the laptop.');
    expect(capture).toContain("batchLocked ? 'Try sending again' : 'Done'");
  });

  it('replaces all capture state when a fresh code is scanned on the same page', () => {
    const capture = readFileSync(
      path.join(root, 'src/app/menu-capture/MenuCaptureClient.tsx'),
      'utf8',
    );

    expect(capture).toContain("window.addEventListener('hashchange', onHashChange)");
    expect(capture).toContain("window.removeEventListener('hashchange', onHashChange)");
    expect(capture.match(/addEventListener\('hashchange'/g)).toHaveLength(1);
    expect(capture).toContain('sessionPromise.current = consumeCurrentPhoneTransferFragment()');
    expect(capture).toContain('if (sessionPromise.current !== pending) return');
    expect(capture.match(/if \(sessionPromise\.current !== activeSessionPromise\) return/g)).toHaveLength(2);
    expect(capture).toContain('controller.current?.abort()');
    expect(capture).toContain('urls.current.forEach((url) => URL.revokeObjectURL(url))');
    expect(capture).toContain('setPhotos([])');
    expect(capture).toContain('setSent(false)');
    expect(capture).toContain("setError('')");
    expect(capture).toContain("setProgress('')");
    expect(capture).toContain('batchLockedRef.current = false');
    expect(capture).toContain('setBatchLocked(false)');
    expect(capture).toContain("setLinkState('invalid')");
  });

  it('scopes every asynchronous send update to its exact session and controller', () => {
    const capture = readFileSync(
      path.join(root, 'src/app/menu-capture/MenuCaptureClient.tsx'),
      'utf8',
    );

    expect(capture).toContain(
      'sessionRef.current === activeSession && controller.current === nextController',
    );
    expect(capture.match(/if \(!isCurrentSend\(\)\) return/g)).toHaveLength(3);
    expect(capture).toContain('if (isCurrentSend()) {');
  });

  it('promises automatic arrival without asking for sign-in or refresh', () => {
    const html = renderToStaticMarkup(
      <PhonePhotoTransfer
        currentPhotoCount={0}
        onGalleryChanged={jest.fn()}
        onReceived={jest.fn()}
        workspaceId="workspace-a"
      />,
    );

    expect(html).toContain('Scan with your phone. Take up to 10 photos. They arrive here automatically.');
    expect(html).toContain('Use your phone');
    expect(html).not.toMatch(/sign in/i);
    expect(html).not.toMatch(/refresh/i);
  });

  it('polls only while the QR panel is open and visible, with full cleanup', () => {
    const source = readFileSync(
      path.join(root, 'src/components/menus/PhonePhotoTransfer.tsx'),
      'utf8',
    );

    expect(source).toContain("if (!open || !session) return");
    expect(source).toContain("document.visibilityState !== 'visible'");
    expect(source).toContain('}, 2_000)');
    expect(source).toContain("document.addEventListener('visibilitychange'");
    expect(source).toContain("document.removeEventListener('visibilitychange'");
    expect(source).toContain('activeController?.abort()');
  });

  it('accurately distinguishes local picker privacy from temporary encrypted transfer', () => {
    const menuWorkspace = readFileSync(
      path.join(root, 'src/components/menus/MenuWorkspace.tsx'),
      'utf8',
    );
    const phoneTransfer = readFileSync(
      path.join(root, 'src/components/menus/PhonePhotoTransfer.tsx'),
      'utf8',
    );

    expect(menuWorkspace).toContain('never uploaded or saved');
    expect(menuWorkspace).toContain('Choose up to 10');
    expect(menuWorkspace).toContain('Photos chosen on this laptop stay here');
    expect(menuWorkspace).toContain('Phone photos travel as encrypted temporary copies');
    expect(phoneTransfer).toMatch(/encrypted/i);
    expect(phoneTransfer).toMatch(/temporar/i);
    expect(phoneTransfer).toMatch(/this (laptop|browser)/i);
  });

  it('renders the bounded on-laptop gallery with explicit local removal', () => {
    const html = renderToStaticMarkup(
      <LocalMenuPhotoGallery workspaceId="workspace-a" refreshKey={0} />,
    );
    const source = readFileSync(
      path.join(root, 'src/components/menus/PhonePhotoTransfer.tsx'),
      'utf8',
    );

    expect(html).toContain('Photos on this laptop');
    expect(source).toContain('Remove from this laptop');
    expect(source).toContain('URL.revokeObjectURL');
  });

  it('provides the authenticated workspace ID without storing it in the transfer link', () => {
    const layout = readFileSync(path.join(root, 'src/app/(app)/layout.tsx'), 'utf8');
    const context = readFileSync(path.join(root, 'src/components/WorkspaceContext.tsx'), 'utf8');
    const localPhotos = readFileSync(path.join(root, 'src/lib/menu/local-menu-photos.ts'), 'utf8');

    expect(layout).toContain('<WorkspaceProvider workspaceId={workspaceId}>');
    expect(context).toContain('createContext');
    expect(context).not.toMatch(/localStorage|sessionStorage/);
    expect(localPhotos).toContain("transaction(STORE_NAME, 'readwrite')");
    expect(localPhotos).toContain("index('workspaceId')");
    expect(localPhotos).toContain('record.workspaceId !== workspaceId');
    expect(localPhotos).toContain('localMenuPhotoRecordIdsToEvict');
    expect(localPhotos).toContain('store.delete(recordId)');
  });

  it('links every participating local batch before navigating to the menu', () => {
    const menuWorkspace = readFileSync(
      path.join(root, 'src/components/menus/MenuWorkspace.tsx'),
      'utf8',
    );
    const associateAt = menuWorkspace.indexOf('await associateLocalPhotoBatches');
    const navigateAt = menuWorkspace.indexOf('onCreated(result.menuId)');

    expect(associateAt).toBeGreaterThan(0);
    expect(navigateAt).toBeGreaterThan(associateAt);
  });
});
