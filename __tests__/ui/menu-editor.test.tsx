import { renderToStaticMarkup } from 'react-dom/server';

import {
  applyMenuCleanupProposal,
  MenuEditor,
} from '@/components/menus/MenuEditor';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

describe('menu editor', () => {
  it('applies one reviewed cleanup change without touching other menu facts', () => {
    const document = {
      v: 1 as const,
      source: { kind: 'PASTE' as const, canonicalUrl: null, permissionConfirmed: false },
      dishes: [{
        id: 'dish1', name: '1. Dal makhani ₹250', position: 0,
        ingredients: [{
          id: 'ingredient1', itemKey: 'tomato', name: 'Tomatos', quantity: '2',
          unit: 'KILOGRAM' as const, specification: { v: 1 as const, category: 'VEGETABLES' as const },
        }],
      }],
    };

    expect(applyMenuCleanupProposal(document, {
      id: 'p1', kind: 'CORRECT_SPELLING', source: 'DETERMINISTIC_RULE', applied: false,
      dishId: 'dish1', ingredientId: 'ingredient1', before: 'Tomatos', after: 'Tomatoes',
      evidence: 'Reviewed spelling.',
    }).dishes[0]).toEqual({
      ...document.dishes[0],
      ingredients: [{ ...document.dishes[0].ingredients[0], name: 'Tomatoes' }],
    });
  });

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
          document: {
            v: 1,
            source: { kind: 'PASTE', canonicalUrl: null, permissionConfirmed: false },
            dishes: [
              {
                id: 'dish1',
                name: 'Dal makhani',
                position: 0,
                ingredients: [
                  {
                    id: 'ingredient1',
                    itemKey: 'urad-dal',
                    name: 'Urad dal',
                    quantity: '2.5',
                    unit: 'KILOGRAM',
                    specification: { v: 1, category: 'GRAINS_PULSES' },
                  },
                ],
              },
            ],
          },
          ingredientSuggestionsByDishId: {
            dish1: [
              {
                id: 'suggestion1',
                kind: 'INGREDIENT',
                itemKey: 'butter',
                name: 'Butter',
                quantity: '0.2',
                unit: 'KILOGRAM',
                specification: { v: 1, category: 'DAIRY' },
                source: 'REVIEWED_TEMPLATE',
                sourceLabel: 'Reviewed dish template',
                evidence: 'Matched Dal makhani.',
                selected: false,
              },
            ],
          },
          cleanupProposals: [{
            id: 'p1', kind: 'CORRECT_SPELLING', source: 'DETERMINISTIC_RULE', applied: false,
            dishId: 'dish1', ingredientId: 'ingredient1', before: 'Urad daal', after: 'Urad dal',
            evidence: 'Reviewed spelling.',
          }],
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
    expect(html).toContain('Quick add');
    expect(html).toContain('Butter');
    expect(html).toContain('Suggested cleanup');
    expect(html).toContain('Urad daal');
    expect(html).toContain('Use change');
    expect(html).toContain('Reviewed dish template');
    expect(html).toContain('0.2 kg');
    expect(html).toContain('Food photo or product link, optional');
  });
});
