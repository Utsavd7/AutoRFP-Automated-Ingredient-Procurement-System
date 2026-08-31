import { buildDeterministicMenuDraft } from '@/lib/menu/menu-document';

describe('buildDeterministicMenuDraft', () => {
  it('turns each non-empty trimmed user line into a review-required dish', () => {
    expect(
      buildDeterministicMenuDraft('  Paneer Tikka  \n\n Masala Dosa\n'),
    ).toEqual([
      { id: 'd1', name: 'Paneer Tikka', position: 0, ingredients: [] },
      { id: 'd2', name: 'Masala Dosa', position: 1, ingredients: [] },
    ]);
  });

  it('never invents ingredients or changes user-provided dish lines', () => {
    const userLines = ['Dal Makhani - ₹260', 'Hyderabadi Veg Biryani'];
    const dishes = buildDeterministicMenuDraft(userLines.join('\n'));

    expect(dishes.map((dish) => dish.name)).toEqual(userLines);
    expect(dishes.every((dish) => dish.ingredients.length === 0)).toBe(true);
  });

  it('preserves duplicate lines for explicit review', () => {
    expect(
      buildDeterministicMenuDraft(
        'Paneer Tikka\npaneer tikka\nPANEER TIKKA\nMasala Dosa',
      ).map((dish) => dish.name),
    ).toEqual(['Paneer Tikka', 'paneer tikka', 'PANEER TIKKA', 'Masala Dosa']);
  });

  it('rejects more than 250 dishes instead of silently dropping demand', () => {
    expect(() =>
      buildDeterministicMenuDraft(
        Array.from({ length: 251 }, (_, index) => `Dish ${index + 1}`).join(
          '\n',
        ),
      ),
    ).toThrow(/at most 250 dishes/);
  });

  it('rejects a dish line that exceeds the persisted fact boundary', () => {
    expect(() => buildDeterministicMenuDraft('₹'.repeat(54))).toThrow(
      /160 UTF-8 bytes or fewer/,
    );
  });
});
