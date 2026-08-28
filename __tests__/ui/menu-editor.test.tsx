import { renderToStaticMarkup } from 'react-dom/server';

import { MenuEditor } from '@/components/menus/MenuEditor';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

describe('menu editor', () => {
  it('renders a reviewable dish and ingredient form', () => {
    const html = renderToStaticMarkup(
      <MenuEditor
        menuId="menu-1"
        initialMenu={{
          id: 'menu-1',
          name: 'Dinner menu',
          status: 'DRAFT',
          version: 2,
          sourceText: null,
          approvedAt: null,
          updatedAt: '2026-08-28T08:00:00.000Z',
          recipes: [
            {
              id: 'dish-1',
              name: 'Dal makhani',
              ingredients: [
                { id: 'ingredient-1', name: 'Urad dal', quantity: '2.5', unit: 'KILOGRAM' },
              ],
            },
          ],
        }}
      />,
    );

    expect(html).toContain('Review menu');
    expect(html).toContain('Dal makhani');
    expect(html).toContain('Urad dal');
    expect(html).toContain('2.5');
    expect(html).toContain('Save draft');
    expect(html).toContain('Approve menu');
    expect(html).toContain('Add ingredient');
    expect(html).toContain('Add dish');
  });
});
