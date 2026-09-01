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
