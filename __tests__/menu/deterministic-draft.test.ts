import { buildDeterministicMenuDraft } from '@/lib/menu/deterministic-draft';

describe('buildDeterministicMenuDraft', () => {
  it('turns each non-empty trimmed user line into a review-required dish', () => {
    expect(
      buildDeterministicMenuDraft('  Paneer Tikka  \n\n Masala Dosa\n'),
    ).toEqual([
      { name: 'Paneer Tikka', ingredients: [], requiresReview: true },
      { name: 'Masala Dosa', ingredients: [], requiresReview: true },
    ]);
  });

  it('never invents ingredients or changes user-provided dish lines', () => {
    const userLines = ['Dal Makhani - ₹260', 'Hyderabadi Veg Biryani'];
    const dishes = buildDeterministicMenuDraft(userLines.join('\n'));

    expect(dishes.map((dish) => dish.name)).toEqual(userLines);
    expect(dishes.every((dish) => dish.ingredients.length === 0)).toBe(true);
    expect(dishes.every((dish) => dish.requiresReview)).toBe(true);
  });

  it('collapses duplicate lines case-insensitively and keeps the first form', () => {
    expect(
      buildDeterministicMenuDraft(
        'Paneer Tikka\npaneer tikka\nPANEER TIKKA\nMasala Dosa',
      ).map((dish) => dish.name),
    ).toEqual(['Paneer Tikka', 'Masala Dosa']);
  });

  it('accepts at most the first 250 unique non-empty user lines', () => {
    const dishes = buildDeterministicMenuDraft(
      Array.from({ length: 300 }, (_, index) => `Dish ${index + 1}`).join('\n'),
    );

    expect(dishes).toHaveLength(250);
    expect(dishes[0]?.name).toBe('Dish 1');
    expect(dishes[249]?.name).toBe('Dish 250');
  });
});
