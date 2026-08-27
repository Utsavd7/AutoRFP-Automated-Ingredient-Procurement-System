const MAX_DISHES = 250;

export type DeterministicDishDraft = {
  name: string;
  ingredients: never[];
  requiresReview: true;
};

export function buildDeterministicMenuDraft(
  menuText: string,
): DeterministicDishDraft[] {
  const seen = new Set<string>();
  const dishes: DeterministicDishDraft[] = [];

  for (const rawLine of menuText.split(/\r?\n/)) {
    const name = rawLine.trim();
    if (!name) continue;

    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;

    seen.add(key);
    dishes.push({ name, ingredients: [], requiresReview: true });
    if (dishes.length === MAX_DISHES) break;
  }

  return dishes;
}
