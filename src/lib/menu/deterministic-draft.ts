const MAX_DISHES = 250;
const MAX_DISH_NAME_BYTES = 160;

export class DeterministicMenuDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeterministicMenuDraftError';
  }
}

export type DeterministicDishDraft = {
  name: string;
  ingredients: never[];
};

export function buildDeterministicMenuDraft(
  menuText: string,
): DeterministicDishDraft[] {
  const seen = new Set<string>();
  const dishes: DeterministicDishDraft[] = [];

  for (const rawLine of menuText.split(/\r?\n/)) {
    const name = rawLine.trim();
    if (!name) continue;
    if (new TextEncoder().encode(name).byteLength > MAX_DISH_NAME_BYTES) {
      throw new DeterministicMenuDraftError(
        `Dish names must be ${MAX_DISH_NAME_BYTES} UTF-8 bytes or fewer.`,
      );
    }

    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    if (dishes.length >= MAX_DISHES) {
      throw new DeterministicMenuDraftError(
        `Menu text may contain at most ${MAX_DISHES} unique dishes. Split or correct the menu before continuing.`,
      );
    }

    seen.add(key);
    dishes.push({ name, ingredients: [] });
  }

  return dishes;
}
