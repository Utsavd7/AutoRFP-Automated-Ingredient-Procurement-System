import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';

import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
import {
  applyMenuCleanupProposal,
  deleteMenuAndNavigate,
  MenuEditor,
  pruneSelectedDishIds,
  removeSelectedDishes,
} from '@/components/menus/MenuEditor';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/client/workspace-prefetch', () => ({
  workspaceMutationFetch: jest.fn(),
}));

const workspaceMutationFetchMock = workspaceMutationFetch as jest.MockedFunction<typeof workspaceMutationFetch>;

describe('menu editor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('removes selected dishes, preserves surviving data, and reindexes positions', () => {
    const dishes = [
      { id: 'first', name: 'First', position: 0, ingredients: [] },
      { id: 'middle', name: 'Middle', position: 1, ingredients: [{ id: 'ingredient', itemKey: 'rice', name: 'Rice', quantity: '1', unit: 'KILOGRAM' as const, specification: { v: 1 as const, category: 'GRAINS_PULSES' as const } }] },
      { id: 'third', name: 'Third', position: 2, ingredients: [] },
    ];

    const result = removeSelectedDishes(dishes, new Set(['first', 'third']));

    expect(result).toEqual([{ ...dishes[1], position: 0 }]);
  });

  it('prunes selections for a dish removed by a cleanup merge', () => {
    const document = {
      v: 1 as const,
      source: { kind: 'PASTE' as const, canonicalUrl: null, permissionConfirmed: false },
      dishes: [
        { id: 'kept', name: 'Kept', position: 0, ingredients: [] },
        { id: 'removed', name: 'Removed', position: 1, ingredients: [] },
      ],
    };
    const cleaned = applyMenuCleanupProposal(document, {
      id: 'merge-1', kind: 'MERGE_DUPLICATE_DISH', source: 'DETERMINISTIC_RULE', applied: false,
      dishId: 'removed', ingredientId: null, before: 'Removed', after: 'Kept', evidence: 'Duplicate dish.',
    });

    expect(pruneSelectedDishIds(new Set(['kept', 'removed']), cleaned.dishes)).toEqual(new Set(['kept']));
  });

  it('sends the expected delete request and remains locked after navigation begins', async () => {
    let confirmed = false;
    const onConfirmed = jest.fn(() => { confirmed = true; });
    workspaceMutationFetchMock.mockImplementation(async () => {
      expect(confirmed).toBe(true);
      return new Response(null, { status: 204 });
    });
    const router = { replace: jest.fn(), refresh: jest.fn() };

    await expect(deleteMenuAndNavigate({ id: 'menu/with slash', version: 4 }, router, () => true, onConfirmed)).resolves.toEqual({ status: 'deleted', error: null, keepLocked: true });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(workspaceMutationFetchMock).toHaveBeenCalledWith('/api/menus/menu%2Fwith%20slash', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 4 }),
    });
    expect(router.replace).toHaveBeenCalledWith('/menus');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('surfaces a deletion problem detail and unlocks the editor', async () => {
    workspaceMutationFetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'This menu is used in procurement history.' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }));
    const router = { replace: jest.fn(), refresh: jest.fn() };

    await expect(deleteMenuAndNavigate({ id: 'menu-1', version: 2 }, router, () => true)).resolves.toEqual({
      status: 'failed',
      error: 'This menu is used in procurement history.',
      keepLocked: false,
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('does not start deletion when confirmation is cancelled', async () => {
    const confirm = jest.fn(() => false);
    const onConfirmed = jest.fn();
    const router = { replace: jest.fn(), refresh: jest.fn() };

    await expect(deleteMenuAndNavigate({ id: 'menu-1', version: 2 }, router, confirm, onConfirmed)).resolves.toEqual({
      status: 'cancelled',
      error: null,
      keepLocked: false,
    });
    expect(confirm).toHaveBeenCalledWith('Delete this menu permanently? Menus used in procurement history cannot be deleted.');
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(workspaceMutationFetchMock).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('wires cleanup pruning and deletion lifecycle into editor state', () => {
    const source = readFileSync('src/components/menus/MenuEditor.tsx', 'utf8');

    expect(source).toMatch(/pruneSelectedDishIds\s*\(\s*current\s*,\s*cleanedDocument\.dishes\s*\)/);
    expect(source).toMatch(/deleteMenuAndNavigate\s*\(\s*menu\s*,\s*router\s*,\s*window\.confirm\s*,/);
    expect(source).toMatch(/if\s*\(\s*!result\.keepLocked\s*\)\s*\{?\s*setDeleting\(false\)/);
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
    expect(html).toContain('Select all');
    expect(html).toContain('Clear selection');
    expect(html).toContain('Remove selected');
    expect(html).toContain('Delete menu');
    expect(html).toContain('Select Dal makhani');
    expect(html).toContain('class="dishSelection"');
  });
});
