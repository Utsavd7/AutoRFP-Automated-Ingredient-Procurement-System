import {
  createDeterministicMenuDraft,
  MENU_LIMITS,
  MenuValidationError,
  validateMenuDraftInput,
} from '@/lib/menu/menu-service';

const ingredient = {
  name: 'Tomato',
  quantity: '1.250',
  unit: 'kg',
};

describe('menu draft validation', () => {
  it('normalizes only reviewable menu facts for persistence', () => {
    expect(
      validateMenuDraftInput({
        name: '  Dinner menu  ',
        sourceText: '  Paneer Tikka\nMasala Dosa  ',
        dishes: [
          {
            id: ' recipe-1 ',
            name: '  Paneer Tikka  ',
            ingredients: [
              {
                id: ' ingredient-1 ',
                name: '  Paneer  ',
                quantity: '1.250',
                unit: 'kg',
                ignoredPrice: 900,
              },
            ],
            ignoredClaim: 'verified',
          },
        ],
        ignoredRecommendation: 'Buy now',
      }),
    ).toEqual({
      name: 'Dinner menu',
      sourceText: 'Paneer Tikka\nMasala Dosa',
      dishes: [
        {
          id: 'recipe-1',
          name: 'Paneer Tikka',
          ingredients: [
            {
              id: 'ingredient-1',
              name: 'Paneer',
              quantity: '1.25',
              unit: 'KILOGRAM',
            },
          ],
        },
      ],
    });
  });

  test.each([
    ['blank menu name', { name: ' ', dishes: [] }],
    [
      'oversized menu name',
      { name: '₹'.repeat(Math.ceil(MENU_LIMITS.nameBytes / 3) + 1), dishes: [] },
    ],
    [
      'oversized source text',
      { name: 'Menu', sourceText: '₹'.repeat(33_334), dishes: [] },
    ],
    [
      'too many dishes',
      {
        name: 'Menu',
        dishes: Array.from(
          { length: MENU_LIMITS.dishes + 1 },
          (_, index) => ({ name: `Dish ${index}`, ingredients: [] }),
        ),
      },
    ],
    [
      'too many ingredients in one dish',
      {
        name: 'Menu',
        dishes: [
          {
            name: 'Dish',
            ingredients: Array.from(
              { length: MENU_LIMITS.ingredientsPerDish + 1 },
              (_, index) => ({ ...ingredient, name: `Ingredient ${index}` }),
            ),
          },
        ],
      },
    ],
    [
      'too many ingredients in total',
      {
        name: 'Menu',
        dishes: Array.from({ length: 21 }, (_, dishIndex) => ({
          name: `Dish ${dishIndex}`,
          ingredients: Array.from({ length: 50 }, (_, ingredientIndex) => ({
            ...ingredient,
            name: `Ingredient ${dishIndex}-${ingredientIndex}`,
          })),
        })),
      },
    ],
    [
      'oversized dish name',
      {
        name: 'Menu',
        dishes: [{ name: 'a'.repeat(MENU_LIMITS.factBytes + 1), ingredients: [] }],
      },
    ],
    [
      'oversized ingredient name',
      {
        name: 'Menu',
        dishes: [
          {
            name: 'Dish',
            ingredients: [
              { ...ingredient, name: 'a'.repeat(MENU_LIMITS.factBytes + 1) },
            ],
          },
        ],
      },
    ],
    [
      'unsupported unit',
      {
        name: 'Menu',
        dishes: [
          { name: 'Dish', ingredients: [{ ...ingredient, unit: 'bunch' }] },
        ],
      },
    ],
    [
      'zero quantity',
      {
        name: 'Menu',
        dishes: [
          { name: 'Dish', ingredients: [{ ...ingredient, quantity: '0' }] },
        ],
      },
    ],
    [
      'over-precise quantity',
      {
        name: 'Menu',
        dishes: [
          { name: 'Dish', ingredients: [{ ...ingredient, quantity: '1.0001' }] },
        ],
      },
    ],
    [
      'overflowing quantity',
      {
        name: 'Menu',
        dishes: [
          {
            name: 'Dish',
            ingredients: [
              { ...ingredient, quantity: '1000000000000000.000' },
            ],
          },
        ],
      },
    ],
  ])('rejects %s', (_label, input) => {
    expect(() => validateMenuDraftInput(input)).toThrow(MenuValidationError);
  });

  it('rejects duplicate or unbounded nested IDs', () => {
    expect(() =>
      validateMenuDraftInput({
        name: 'Menu',
        dishes: [
          { id: 'recipe-1', name: 'A', ingredients: [] },
          { id: 'recipe-1', name: 'B', ingredients: [] },
        ],
      }),
    ).toThrow(MenuValidationError);

    expect(() =>
      validateMenuDraftInput({
        name: 'Menu',
        dishes: [
          {
            name: 'A',
            ingredients: [{ ...ingredient, id: 'x'.repeat(201) }],
          },
        ],
      }),
    ).toThrow(MenuValidationError);
  });

  it('bounds raw deterministic input before splitting it into dishes', async () => {
    await expect(
      createDeterministicMenuDraft({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
        name: 'Menu',
        menuText: 'a'.repeat(MENU_LIMITS.sourceBytes + 1),
      }),
    ).rejects.toBeInstanceOf(MenuValidationError);
  });

  it('maps an overlong deterministic dish to a reviewable validation error', async () => {
    await expect(
      createDeterministicMenuDraft({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
        name: 'Menu',
        menuText: '₹'.repeat(54),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_MENU',
      errors: { menuText: [expect.stringMatching(/160 UTF-8 bytes/)] },
    });
  });

  it('maps deterministic overflow to a validation error requiring correction', async () => {
    await expect(
      createDeterministicMenuDraft({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
        name: 'Menu',
        menuText: Array.from(
          { length: MENU_LIMITS.dishes + 1 },
          (_, index) => `Dish ${index + 1}`,
        ).join('\n'),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_MENU',
      errors: { menuText: [expect.stringMatching(/at most 250 unique dishes/)] },
    });
  });

  it('requires a positive expected version for edits and approvals', async () => {
    const transactionHost = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };

    const { approveReviewedMenu, updateReviewedMenuDraft } = await import(
      '@/lib/menu/menu-service'
    );
    await expect(
      updateReviewedMenuDraft(
        {
          actor: { tenantId: 'tenant-a', userId: 'member-a' },
          menuId: 'menu-a',
          expectedVersion: 0,
          draft: { name: 'Menu', dishes: [] },
        },
        transactionHost as never,
      ),
    ).rejects.toBeInstanceOf(MenuValidationError);
    await expect(
      approveReviewedMenu(
        {
          actor: { tenantId: 'tenant-a', userId: 'member-a' },
          menuId: 'menu-a',
          expectedVersion: Number.NaN,
        },
        transactionHost as never,
      ),
    ).rejects.toBeInstanceOf(MenuValidationError);
    expect(transactionHost.$transaction).not.toHaveBeenCalled();
  });

  it('rejects total ingredient overflow before inspecting ingredient fields', () => {
    let deepReads = 0;
    const guardedIngredient = Object.defineProperties(
      {},
      {
        name: {
          enumerable: true,
          get() {
            deepReads += 1;
            throw new Error('deep ingredient validation must not run');
          },
        },
        quantity: {
          enumerable: true,
          get() {
            deepReads += 1;
            throw new Error('deep ingredient validation must not run');
          },
        },
        unit: {
          enumerable: true,
          get() {
            deepReads += 1;
            throw new Error('deep ingredient validation must not run');
          },
        },
      },
    );
    const oversized = {
      name: 'Oversized menu',
      dishes: Array.from({ length: 21 }, (_, index) => ({
        name: `Dish ${index + 1}`,
        ingredients: Array(50).fill(guardedIngredient),
      })),
    };

    let caught: unknown;
    try {
      validateMenuDraftInput(oversized);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MenuValidationError);
    expect(caught).toMatchObject({
      errors: {
        dishes: ['A menu may contain at most 1,000 ingredients in total.'],
      },
    });
    expect(Object.keys((caught as MenuValidationError).errors)).toEqual([
      'dishes',
    ]);
    expect(JSON.stringify((caught as MenuValidationError).errors).length).toBeLessThan(120);
    expect(deepReads).toBe(0);
  });
});
