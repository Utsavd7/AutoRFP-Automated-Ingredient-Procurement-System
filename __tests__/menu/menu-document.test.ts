import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  buildDeterministicMenuDraft,
  buildIngredientSuggestions,
  MenuDocumentValidationError,
  proposeMenuCleanup,
  validateMenuDocument,
  type MenuDocumentV1,
} from '@/lib/menu/menu-document';

const TINY_WEBP_BASE64 =
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

const specification = { v: 1 as const, category: 'OTHER' as const };

function ingredient(
  overrides: Partial<MenuDocumentV1['dishes'][number]['ingredients'][number]> = {},
) {
  return {
    id: 'i1',
    itemKey: 'tomato',
    name: 'Tomato',
    quantity: '1.25',
    unit: 'KILOGRAM' as const,
    specification,
    ...overrides,
  };
}

function documentWith(
  dishes: MenuDocumentV1['dishes'] = [
    {
      id: 'd1',
      name: 'Tomato Curry',
      position: 0,
      ingredients: [ingredient()],
    },
  ],
): MenuDocumentV1 {
  return {
    v: 1,
    source: {
      kind: 'MANUAL',
      canonicalUrl: null,
      permissionConfirmed: false,
    },
    dishes,
  };
}

describe('MenuDocumentV1', () => {
  test('returns the exact bounded shape with canonical decimal quantities and units', () => {
    const input = documentWith();
    input.dishes[0]!.ingredients[0] = {
      ...input.dishes[0]!.ingredients[0]!,
      quantity: '1.250',
      unit: 'kg' as never,
    };

    expect(validateMenuDocument(input)).toEqual(documentWith());
  });

  test('preserves duplicate dish names and same-dish itemKeys for unapplied cleanup proposals', () => {
    const valid = documentWith([
      { id: 'd1', name: 'Soup', position: 0, ingredients: [ingredient()] },
      {
        id: 'd2',
        name: 'sOUP',
        position: 1,
        ingredients: [
          ingredient({ id: 'i2' }),
          ingredient({ id: 'i3', name: 'Tomatoes' }),
        ],
      },
    ]);
    expect(validateMenuDocument(valid)).toEqual(valid);

    expect(proposeMenuCleanup(valid).proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'MERGE_DUPLICATE_DISH', applied: false }),
        expect.objectContaining({ kind: 'MERGE_DUPLICATE_ITEM', applied: false }),
      ]),
    );
  });

  test('keeps permitted URL provenance canonical and free of tracking details', () => {
    const input = documentWith();
    input.source = {
      kind: 'PERMITTED_URL',
      canonicalUrl: 'https://restaurant.example/menu?campaign=1',
      permissionConfirmed: true,
    };
    expect(() => validateMenuDocument(input)).toThrow(MenuDocumentValidationError);
  });

  test.each([
    ['root keys', () => ({ ...documentWith(), extra: true })],
    [
      'source keys',
      () => ({
        ...documentWith(),
        source: { ...documentWith().source, label: 'untrusted' },
      }),
    ],
    [
      'dish keys',
      () => ({
        ...documentWith(),
        dishes: [{ ...documentWith().dishes[0], claim: 'verified' }],
      }),
    ],
    [
      'ingredient keys',
      () => ({
        ...documentWith(),
        dishes: [
          {
            ...documentWith().dishes[0],
            ingredients: [{ ...ingredient(), price: 99 }],
          },
        ],
      }),
    ],
  ])('strictly rejects unknown %s', (_label, makeInput) => {
    expect(() => validateMenuDocument(makeInput())).toThrow(/unknown key/i);
  });

  test.each([
    [
      'duplicate document IDs',
      documentWith([
        { id: 'd1', name: 'Dal', position: 0, ingredients: [ingredient({ id: 'd1' })] },
      ]),
    ],
    [
      'long IDs',
      documentWith([
        { id: `d${'x'.repeat(32)}`, name: 'Dal', position: 0, ingredients: [] },
      ]),
    ],
    [
      'unstable positions',
      documentWith([{ id: 'd1', name: 'Dal', position: 1, ingredients: [] }]),
    ],
    [
      'non-string quantities',
      documentWith([
        {
          id: 'd1',
          name: 'Dal',
          position: 0,
          ingredients: [ingredient({ quantity: 1 as never })],
        },
      ]),
    ],
  ])('rejects %s', (_label, input) => {
    expect(() => validateMenuDocument(input)).toThrow(MenuDocumentValidationError);
  });

  test('enforces dish, per-dish, total-item, name, JSON, and thumbnail limits', () => {
    const makeDishes = (dishCount: number, itemCount: number) =>
      Array.from({ length: dishCount }, (_, dishIndex) => ({
        id: `d${dishIndex + 1}`,
        name: `Dish ${dishIndex + 1}`,
        position: dishIndex,
        ingredients: Array.from({ length: itemCount }, (_, itemIndex) =>
          ingredient({
            id: `i${dishIndex * itemCount + itemIndex + 1}`,
            itemKey: `item-${itemIndex + 1}`,
            name: `Item ${itemIndex + 1}`,
          }),
        ),
      }));

    const cases: unknown[] = [
      documentWith(makeDishes(DOCUMENT_LIMITS.menu.dishes + 1, 0)),
      documentWith(makeDishes(1, 51)),
      documentWith(makeDishes(21, 50)),
      documentWith([{ id: 'd1', name: '₹'.repeat(54), position: 0, ingredients: [] }]),
      documentWith([
        {
          id: 'd1',
          name: 'Images',
          position: 0,
          ingredients: Array.from({ length: DOCUMENT_LIMITS.thumbnails.perDocument + 1 }, (_, index) =>
            ingredient({
              id: `i${index + 1}`,
              itemKey: `image-${index + 1}`,
              name: `Image ${index + 1}`,
              specification: {
                ...specification,
                thumbnailWebpBase64: TINY_WEBP_BASE64,
              },
            }),
          ),
        },
      ]),
      documentWith(
        makeDishes(10, 50).map((dish) => ({
          ...dish,
          ingredients: dish.ingredients.map((item) => ({
            ...item,
            specification: {
              ...specification,
              description: 'd'.repeat(500),
              notes: 'n'.repeat(1000),
            },
          })),
        })),
      ),
    ];

    for (const input of cases) {
      expect(() => validateMenuDocument(input)).toThrow(MenuDocumentValidationError);
    }
  });
});

describe('deterministic menu review proposals', () => {
  test('preserves every line with short stable IDs and proposes changes without applying them', () => {
    const dishes = buildDeterministicMenuDraft(
      '• Paneer Tikka - ₹260\npaneer tikka\npaneer tikka',
    );
    expect(dishes).toEqual([
      { id: 'd1', name: '• Paneer Tikka - ₹260', position: 0, ingredients: [] },
      { id: 'd2', name: 'paneer tikka', position: 1, ingredients: [] },
      { id: 'd3', name: 'paneer tikka', position: 2, ingredients: [] },
    ]);

    const raw = documentWith([
      {
        id: 'd1',
        name: '• Tomato Curry - ₹260',
        position: 0,
        ingredients: [
          ingredient({ id: 'i1', itemKey: 'tomato', name: 'Tomatos', unit: 'kg' as never }),
          ingredient({ id: 'i2', itemKey: 'tomato', name: 'Curd' }),
        ],
      },
    ]);
    const result = proposeMenuCleanup(raw);

    expect(result.cleaned).toEqual(raw);
    expect(result.cleaned.dishes[0]!.ingredients).toHaveLength(2);
    expect(result.proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'REMOVE_NOISE', source: 'DETERMINISTIC_RULE', applied: false }),
        expect.objectContaining({ kind: 'MERGE_DUPLICATE_ITEM', source: 'DETERMINISTIC_RULE', applied: false }),
        expect.objectContaining({ kind: 'CORRECT_SPELLING', source: 'DETERMINISTIC_RULE', applied: false }),
        expect.objectContaining({ kind: 'MERGE_SYNONYM', source: 'DETERMINISTIC_RULE', applied: false }),
        expect.objectContaining({ kind: 'NORMALIZE_UNIT', source: 'DETERMINISTIC_RULE', applied: false }),
      ]),
    );
    expect(result.proposals.every(({ applied }) => applied === false)).toBe(true);
  });
});

describe('ingredient suggestions', () => {
  test('uses approved evidence, reviewed templates, dish-name evidence, then manual fallback', () => {
    const current = documentWith([
      { id: 'd1', name: 'Paneer Tikka', position: 0, ingredients: [] },
      { id: 'd2', name: 'Masala Dosa', position: 1, ingredients: [] },
      { id: 'd3', name: 'Tomato Soup', position: 2, ingredients: [] },
      { id: 'd4', name: 'Quantum Foam', position: 3, ingredients: [] },
      { id: 'd5', name: 'Rajma', position: 4, ingredients: [] },
      { id: 'd6', name: 'Veg Biryani', position: 5, ingredients: [] },
    ]);
    const approved = documentWith([
      {
        id: 'old-dish',
        name: 'paneer tikka',
        position: 0,
        ingredients: [ingredient({ id: 'old-item', itemKey: 'paneer', name: 'Paneer' })],
      },
    ]);

    const suggestions = buildIngredientSuggestions(current, [
      { menuName: 'Approved summer menu', document: approved },
    ]);

    expect(suggestions.d1[0]).toEqual(
      expect.objectContaining({
        kind: 'INGREDIENT',
        name: 'Paneer',
        source: 'APPROVED_SAME_DISH',
        sourceLabel: 'From your approved Paneer Tikka',
        selected: false,
      }),
    );
    expect(suggestions.d2[0]).toEqual(
      expect.objectContaining({
        kind: 'INGREDIENT',
        source: 'REVIEWED_TEMPLATE',
        sourceLabel: 'From the reviewed Indian dish template',
        selected: false,
      }),
    );
    expect(suggestions.d3[0]).toEqual(
      expect.objectContaining({
        kind: 'INGREDIENT',
        name: 'Tomato',
        source: 'DISH_NAME',
        sourceLabel: 'From words in this dish name',
        selected: false,
      }),
    );
    expect(suggestions.d4).toEqual([
      expect.objectContaining({
        kind: 'MANUAL_FALLBACK',
        source: 'MANUAL',
        sourceLabel: 'Enter ingredients manually',
        selected: false,
      }),
    ]);
    expect(suggestions.d5).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'INGREDIENT', name: 'Rajma' }),
      expect.objectContaining({ kind: 'INGREDIENT', name: 'Onion' }),
      expect.objectContaining({ kind: 'INGREDIENT', name: 'Tomato' }),
    ]));
    expect(suggestions.d6).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'INGREDIENT', name: 'Basmati rice' }),
      expect.objectContaining({ kind: 'INGREDIENT', name: 'Mixed vegetables' }),
    ]));

    for (const suggestion of Object.values(suggestions).flat()) {
      expect(new TextEncoder().encode(suggestion.sourceLabel).byteLength).toBeLessThanOrEqual(160);
      expect(new TextEncoder().encode(suggestion.evidence).byteLength).toBeLessThanOrEqual(320);
    }
  });
});
