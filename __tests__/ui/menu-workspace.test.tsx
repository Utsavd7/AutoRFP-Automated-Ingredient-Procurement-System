import { renderToStaticMarkup } from 'react-dom/server';

import {
  MenuIntakeDialog,
  MenuWorkspace,
} from '@/components/menus/MenuWorkspace';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('menu workspace', () => {
  it('explains review and approval in plain English', () => {
    const html = renderToStaticMarkup(
      <MenuWorkspace
        initialMenus={[
          {
            id: 'menu-1',
            name: 'Dinner menu',
            status: 'DRAFT',
            version: 2,
            approvedAt: null,
            updatedAt: '2026-08-28T08:00:00.000Z',
          },
        ]}
        initialError=""
      />,
    );

    expect(html).toContain('Menus');
    expect(html).toContain('Dinner menu');
    expect(html).toContain('Open and check the ingredient list');
    expect(html).toContain('Needs review');
    expect(html).toContain('Add menu');
    expect(html).toContain('Nothing is sent to suppliers');
    expect(html).not.toContain('AI');
    expect(html).not.toContain('AutoRFP');
  });

  it('has a clear empty state', () => {
    const html = renderToStaticMarkup(
      <MenuWorkspace initialMenus={[]} initialError="" />,
    );

    expect(html).toContain('Add your restaurant menu');
    expect(html).toContain('Paste one dish per line');
  });

  it('offers the next real API page when a cursor is available', () => {
    const Workspace = MenuWorkspace as unknown as React.ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      <Workspace initialMenus={[]} initialError="" initialNextCursor="menu-page-2" />,
    );

    expect(html).toContain('Load more menus');
  });

  it('offers three plainly labelled ways to add a menu', () => {
    const html = renderToStaticMarkup(
      <MenuIntakeDialog onClose={jest.fn()} onCreated={jest.fn()} />,
    );

    expect(html).toContain('Type or paste');
    expect(html).toContain('Photos');
    expect(html).toContain('Permitted website link');
    expect(html).not.toContain('AI');
  });

  it('uses a camera friendly private photo input and clear privacy copy', () => {
    const html = renderToStaticMarkup(
      <MenuIntakeDialog
        initialMode="photo"
        onClose={jest.fn()}
        onCreated={jest.fn()}
      />,
    );

    expect(html).toContain('accept="image/*"');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('never uploaded or saved');
    expect(html).toContain('Use your phone');
  });

  it('requires website permission before importing editable menu text', () => {
    const html = renderToStaticMarkup(
      <MenuIntakeDialog
        initialMode="url"
        onClose={jest.fn()}
        onCreated={jest.fn()}
      />,
    );

    expect(html).toContain('I have permission to use this menu');
    expect(html).toContain('Import menu text');
    expect(html).toContain('type="checkbox"');
  });
});
