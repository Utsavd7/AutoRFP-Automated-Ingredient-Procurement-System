import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  type ItemSpecificationV1,
  validateItemSpecification,
} from '@/lib/domain/item-specification';
import { assertBoundedJson } from '@/lib/domain/postgres-json';
import {
  formatQuantity,
  normalizeUnit,
  parseQuantityToMilli,
  type ProcurementUnit,
} from '@/lib/domain/quantity';

const MENU_DOCUMENT_LIMITS = {
  nameBytes: 160,
  idBytes: 32,
  itemKeyBytes: 80,
  ingredientsPerDish: 50,
  sourceLabelBytes: 160,
  evidenceBytes: 320,
  suggestionsPerDish: 12,
  cleanupProposals: 250,
  ingredientSuggestions: 500,
} as const;

const DOCUMENT_KEYS = new Set(['v', 'source', 'dishes']);
const SOURCE_KEYS = new Set([
  'kind',
  'canonicalUrl',
  'permissionConfirmed',
]);
const DISH_KEYS = new Set(['id', 'name', 'position', 'ingredients']);
const INGREDIENT_KEYS = new Set([
  'id',
  'itemKey',
  'name',
  'quantity',
  'unit',
  'specification',
]);
const SOURCE_KINDS = new Set<MenuDocumentSourceKind>([
  'MANUAL',
  'PASTE',
  'OCR',
  'PERMITTED_URL',
]);

export type MenuDocumentSourceKind =
  | 'MANUAL'
  | 'PASTE'
  | 'OCR'
  | 'PERMITTED_URL';

export type MenuDocumentV1 = {
  v: 1;
  source: {
    kind: MenuDocumentSourceKind;
    canonicalUrl: string | null;
    permissionConfirmed: boolean;
  };
  dishes: Array<{
    id: string;
    name: string;
    position: number;
    ingredients: Array<{
      id: string;
      itemKey: string;
      name: string;
      quantity: string;
      unit: ProcurementUnit;
      specification: ItemSpecificationV1;
    }>;
  }>;
};

export class MenuDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MenuDocumentValidationError';
  }
}

export class DeterministicMenuDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeterministicMenuDraftError';
  }
}

function fail(message: string): never {
  throw new MenuDocumentValidationError(message);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function plainRecord(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be a plain JSON object.`);
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      fail(`${label} contains unknown key ${String(key)}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail(`${label} key ${key} must be an enumerable data property.`);
    }
  }

  return value as Record<string, unknown>;
}

function canonicalText(value: unknown, label: string, maximumBytes: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    byteLength(value) > maximumBytes
  ) {
    fail(
      `${label} must be canonical text of ${maximumBytes} UTF-8 bytes or fewer.`,
    );
  }
  return value;
}

function documentId(value: unknown, label: string, ids: Set<string>): string {
  const id = canonicalText(value, label, MENU_DOCUMENT_LIMITS.idBytes);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    fail(`${label} must be a short document-scoped ID.`);
  }
  if (ids.has(id)) fail(`${label} must be unique within the document.`);
  ids.add(id);
  return id;
}

function itemKey(value: unknown, label: string): string {
  const key = canonicalText(value, label, MENU_DOCUMENT_LIMITS.itemKeyBytes);
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(key)) {
    fail(`${label} must be a stable lowercase item key.`);
  }
  return key;
}

function canonicalSourceUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value) {
    fail('Menu source canonicalUrl must be a bounded canonical HTTPS URL.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('Menu source canonicalUrl must be a bounded canonical HTTPS URL.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.toString() !== value
  ) {
    fail('Menu source canonicalUrl must be a canonical HTTPS URL without credentials, query details, or a fragment.');
  }
  return value;
}

function validateSource(input: unknown): MenuDocumentV1['source'] {
  const source = plainRecord(input, 'Menu source', SOURCE_KEYS);
  if (
    typeof source.kind !== 'string' ||
    !SOURCE_KINDS.has(source.kind as MenuDocumentSourceKind)
  ) {
    fail('Menu source kind is not supported.');
  }
  if (typeof source.permissionConfirmed !== 'boolean') {
    fail('Menu source permissionConfirmed must be boolean.');
  }

  const kind = source.kind as MenuDocumentSourceKind;
  let canonicalUrl: string | null;
  if (kind === 'PERMITTED_URL') {
    canonicalUrl = canonicalSourceUrl(source.canonicalUrl);
    if (!source.permissionConfirmed) {
      fail('Permitted URL menu sources require confirmed permission.');
    }
  } else {
    if (source.canonicalUrl !== null) {
      fail('Only permitted URL menu sources may contain canonicalUrl.');
    }
    canonicalUrl = null;
  }

  return {
    kind,
    canonicalUrl,
    permissionConfirmed: source.permissionConfirmed,
  };
}

function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function validateMenuDocument(input: unknown): MenuDocumentV1 {
  try {
    const root = plainRecord(input, 'Menu document', DOCUMENT_KEYS);
    if (root.v !== 1) fail('Menu document version must be 1.');
    const source = validateSource(root.source);
    if (!Array.isArray(root.dishes)) fail('Menu document dishes must be an array.');
    if (root.dishes.length > DOCUMENT_LIMITS.menu.dishes) {
      fail(`Menu documents may contain at most ${DOCUMENT_LIMITS.menu.dishes} dishes.`);
    }

    let ingredientCount = 0;
    for (const [dishIndex, dishValue] of root.dishes.entries()) {
      const dish = plainRecord(dishValue, `Dish ${dishIndex + 1}`, DISH_KEYS);
      if (!Array.isArray(dish.ingredients)) {
        fail(`Dish ${dishIndex + 1} ingredients must be an array.`);
      }
      if (dish.ingredients.length > MENU_DOCUMENT_LIMITS.ingredientsPerDish) {
        fail(
          `A dish may contain at most ${MENU_DOCUMENT_LIMITS.ingredientsPerDish} ingredients.`,
        );
      }
      ingredientCount += dish.ingredients.length;
      if (ingredientCount > DOCUMENT_LIMITS.menu.ingredients) {
        fail(
          `Menu documents may contain at most ${DOCUMENT_LIMITS.menu.ingredients.toLocaleString('en-US')} ingredients in total.`,
        );
      }
    }

    const ids = new Set<string>();
    let thumbnailCount = 0;
    let thumbnailBytes = 0;
    const dishes: MenuDocumentV1['dishes'] = root.dishes.map(
      (dishValue, dishIndex) => {
        const dish = plainRecord(dishValue, `Dish ${dishIndex + 1}`, DISH_KEYS);
        const id = documentId(dish.id, `Dish ${dishIndex + 1} id`, ids);
        const name = canonicalText(
          dish.name,
          `Dish ${dishIndex + 1} name`,
          MENU_DOCUMENT_LIMITS.nameBytes,
        );
        if (dish.position !== dishIndex) {
          fail('Dish positions must be stable, unique, and match document order.');
        }

        const ingredients = (dish.ingredients as unknown[]).map(
          (ingredientValue, ingredientIndex) => {
            const label = `Dish ${dishIndex + 1} ingredient ${ingredientIndex + 1}`;
            const item = plainRecord(ingredientValue, label, INGREDIENT_KEYS);
            const ingredientId = documentId(item.id, `${label} id`, ids);
            const normalizedItemKey = itemKey(item.itemKey, `${label} itemKey`);
            const itemName = canonicalText(
              item.name,
              `${label} name`,
              MENU_DOCUMENT_LIMITS.nameBytes,
            );

            if (typeof item.quantity !== 'string') {
              fail(`${label} quantity must be an exact decimal string.`);
            }
            let quantity: string;
            let unit: ProcurementUnit;
            try {
              quantity = formatQuantity(parseQuantityToMilli(item.quantity));
            } catch {
              fail(`${label} quantity must be a positive exact decimal with at most three places.`);
            }
            try {
              unit = normalizeUnit(item.unit as string);
            } catch {
              fail(`${label} unit is not supported.`);
            }

            let itemSpecification: ItemSpecificationV1;
            try {
              itemSpecification = validateItemSpecification(item.specification);
            } catch (error) {
              fail(
                `${label} specification is invalid: ${
                  error instanceof Error ? error.message : 'invalid specification'
                }`,
              );
            }
            const thumbnail = itemSpecification.thumbnailWebpBase64;
            if (typeof thumbnail === 'string') {
              thumbnailCount += 1;
              thumbnailBytes += decodedBase64Bytes(thumbnail);
              if (thumbnailCount > DOCUMENT_LIMITS.thumbnails.perDocument) {
                fail(
                  `Menu documents may contain at most ${DOCUMENT_LIMITS.thumbnails.perDocument} thumbnails.`,
                );
              }
              if (thumbnailBytes > DOCUMENT_LIMITS.thumbnails.decodedBytesPerDocument) {
                fail('Menu document thumbnails exceed the total decoded-byte limit.');
              }
            }

            return {
              id: ingredientId,
              itemKey: normalizedItemKey,
              name: itemName,
              quantity,
              unit,
              specification: itemSpecification,
            };
          },
        );

        return { id, name, position: dishIndex, ingredients };
      },
    );

    const document: MenuDocumentV1 = { v: 1, source, dishes };
    assertBoundedJson(
      document,
      DOCUMENT_LIMITS.menu.jsonBytes,
      'Menu document',
    );
    return document;
  } catch (error) {
    if (error instanceof MenuDocumentValidationError) throw error;
    throw new MenuDocumentValidationError(
      error instanceof Error ? error.message : 'Menu document is invalid.',
    );
  }
}

export function buildDeterministicMenuDraft(
  menuText: string,
): MenuDocumentV1['dishes'] {
  if (typeof menuText !== 'string') {
    throw new DeterministicMenuDraftError('Menu text must be text.');
  }

  const dishes: MenuDocumentV1['dishes'] = [];
  for (const rawLine of menuText.split(/\r?\n/)) {
    const name = rawLine.trim();
    if (!name) continue;
    if (
      byteLength(name) > MENU_DOCUMENT_LIMITS.nameBytes ||
      /[\u0000-\u001f\u007f]/.test(name)
    ) {
      throw new DeterministicMenuDraftError(
        `Dish names must be ${MENU_DOCUMENT_LIMITS.nameBytes} UTF-8 bytes or fewer and contain no control characters.`,
      );
    }
    if (dishes.length >= DOCUMENT_LIMITS.menu.dishes) {
      throw new DeterministicMenuDraftError(
        `Menu text may contain at most ${DOCUMENT_LIMITS.menu.dishes} dishes. Split or correct the menu before continuing.`,
      );
    }
    const index = dishes.length;
    dishes.push({ id: `d${index + 1}`, name, position: index, ingredients: [] });
  }
  return dishes;
}

export type MenuCleanupProposalKind =
  | 'REMOVE_NOISE'
  | 'MERGE_DUPLICATE_DISH'
  | 'MERGE_DUPLICATE_ITEM'
  | 'CORRECT_SPELLING'
  | 'MERGE_SYNONYM'
  | 'NORMALIZE_UNIT';

export type MenuCleanupProposal = {
  id: string;
  kind: MenuCleanupProposalKind;
  source: 'DETERMINISTIC_RULE';
  applied: false;
  dishId: string;
  ingredientId: string | null;
  before: string;
  after: string;
  evidence: string;
};

function stripMenuNoise(value: string): string {
  return value
    .replace(/^\s*[•·*-]\s+/, '')
    .replace(
      /\s*(?:[-–—|]\s*)?(?:₹|rs\.?|inr)\s*\d+(?:\.\d{1,2})?\s*$/i,
      '',
    )
    .trim();
}

const SPELLING_CORRECTIONS: Readonly<Record<string, string>> = {
  tomatos: 'Tomatoes',
  potatos: 'Potatoes',
  chilliies: 'Chillies',
  yoghurt: 'Yogurt',
};

const SYNONYM_MERGES: Readonly<Record<string, string>> = {
  curd: 'Yogurt',
  capsicum: 'Bell pepper',
  coriander: 'Cilantro',
};

function cloneDocument(input: MenuDocumentV1): MenuDocumentV1 {
  return {
    v: input.v,
    source: { ...input.source },
    dishes: input.dishes.map((dish) => ({
      ...dish,
      ingredients: dish.ingredients.map((item) => ({
        ...item,
        specification: { ...item.specification },
      })),
    })),
  };
}

export function proposeMenuCleanup(input: MenuDocumentV1): {
  cleaned: MenuDocumentV1;
  proposals: MenuCleanupProposal[];
} {
  const cleaned = cloneDocument(input);
  const proposals: MenuCleanupProposal[] = [];
  const propose = (
    proposal: Omit<MenuCleanupProposal, 'id' | 'source' | 'applied'>,
  ) => {
    if (proposals.length >= MENU_DOCUMENT_LIMITS.cleanupProposals) return;
    proposals.push({
      id: `p${proposals.length + 1}`,
      source: 'DETERMINISTIC_RULE',
      applied: false,
      ...proposal,
    });
  };

  const dishNames = new Map<string, string>();
  for (const dish of input.dishes) {
    const noiseFreeDish = stripMenuNoise(dish.name);
    if (noiseFreeDish && noiseFreeDish !== dish.name) {
      propose({
        kind: 'REMOVE_NOISE',
        dishId: dish.id,
        ingredientId: null,
        before: dish.name,
        after: noiseFreeDish,
        evidence: 'Matched a deterministic list marker or menu price suffix.',
      });
    }
    const dishKey = noiseFreeDish.toLocaleLowerCase('en-US');
    const firstDishId = dishNames.get(dishKey);
    if (firstDishId) {
      propose({
        kind: 'MERGE_DUPLICATE_DISH',
        dishId: dish.id,
        ingredientId: null,
        before: dish.id,
        after: firstDishId,
        evidence: 'The normalized dish names are identical.',
      });
    } else {
      dishNames.set(dishKey, dish.id);
    }

    const itemKeys = new Map<string, string>();
    for (const item of dish.ingredients) {
      const noiseFreeItem = stripMenuNoise(item.name);
      if (noiseFreeItem && noiseFreeItem !== item.name) {
        propose({
          kind: 'REMOVE_NOISE',
          dishId: dish.id,
          ingredientId: item.id,
          before: item.name,
          after: noiseFreeItem,
          evidence: 'Matched a deterministic list marker or menu price suffix.',
        });
      }

      const normalizedName = noiseFreeItem.toLocaleLowerCase('en-US');
      const spelling = SPELLING_CORRECTIONS[normalizedName];
      if (spelling && spelling !== item.name) {
        propose({
          kind: 'CORRECT_SPELLING',
          dishId: dish.id,
          ingredientId: item.id,
          before: item.name,
          after: spelling,
          evidence: 'Matched the reviewed deterministic spelling map.',
        });
      }
      const synonym = SYNONYM_MERGES[normalizedName];
      if (synonym && synonym !== item.name) {
        propose({
          kind: 'MERGE_SYNONYM',
          dishId: dish.id,
          ingredientId: item.id,
          before: item.name,
          after: synonym,
          evidence: 'Matched the reviewed deterministic synonym map.',
        });
      }

      try {
        const normalizedUnit = normalizeUnit(item.unit as string);
        if (normalizedUnit !== item.unit) {
          propose({
            kind: 'NORMALIZE_UNIT',
            dishId: dish.id,
            ingredientId: item.id,
            before: String(item.unit),
            after: normalizedUnit,
            evidence: 'Matched a supported procurement-unit alias.',
          });
        }
      } catch {
        // Unsupported units remain unchanged for manual review.
      }

      const firstItemId = itemKeys.get(item.itemKey);
      if (firstItemId) {
        propose({
          kind: 'MERGE_DUPLICATE_ITEM',
          dishId: dish.id,
          ingredientId: item.id,
          before: item.id,
          after: firstItemId,
          evidence: 'The itemKey is already present in this dish.',
        });
      } else {
        itemKeys.set(item.itemKey, item.id);
      }
    }
  }

  return { cleaned, proposals };
}

type SuggestionSource =
  | 'APPROVED_SAME_DISH'
  | 'REVIEWED_TEMPLATE'
  | 'DISH_NAME'
  | 'MANUAL';

type SuggestionEvidence = {
  id: string;
  source: SuggestionSource;
  sourceLabel: string;
  evidence: string;
  selected: false;
};

export type IngredientSuggestionDto =
  | (SuggestionEvidence & {
      kind: 'INGREDIENT';
      itemKey: string;
      name: string;
      quantity: string;
      unit: ProcurementUnit;
      specification: ItemSpecificationV1;
    })
  | (SuggestionEvidence & { kind: 'MANUAL_FALLBACK' });

export type ApprovedMenuEvidence = {
  menuName: string;
  document: MenuDocumentV1;
};

type TemplateItem = {
  itemKey: string;
  name: string;
  quantity: string;
  unit: ProcurementUnit;
};

const REVIEWED_TEMPLATES: Readonly<Record<string, readonly TemplateItem[]>> = {
  'paneer tikka': [
    { itemKey: 'paneer', name: 'Paneer', quantity: '1', unit: 'KILOGRAM' },
    { itemKey: 'yogurt', name: 'Yogurt', quantity: '0.25', unit: 'KILOGRAM' },
    { itemKey: 'spices', name: 'Spices', quantity: '0.05', unit: 'KILOGRAM' },
  ],
  'dal makhani': [
    { itemKey: 'urad-dal', name: 'Urad dal', quantity: '1', unit: 'KILOGRAM' },
    { itemKey: 'butter', name: 'Butter', quantity: '0.2', unit: 'KILOGRAM' },
  ],
  'masala dosa': [
    { itemKey: 'rice', name: 'Rice', quantity: '1', unit: 'KILOGRAM' },
    { itemKey: 'urad-dal', name: 'Urad dal', quantity: '0.25', unit: 'KILOGRAM' },
    { itemKey: 'potato', name: 'Potato', quantity: '0.5', unit: 'KILOGRAM' },
  ],
};

const DISH_NAME_ITEMS: readonly TemplateItem[] = [
  { itemKey: 'tomato', name: 'Tomato', quantity: '1', unit: 'KILOGRAM' },
  { itemKey: 'potato', name: 'Potato', quantity: '1', unit: 'KILOGRAM' },
  { itemKey: 'paneer', name: 'Paneer', quantity: '1', unit: 'KILOGRAM' },
  { itemKey: 'chicken', name: 'Chicken', quantity: '1', unit: 'KILOGRAM' },
  { itemKey: 'mushroom', name: 'Mushroom', quantity: '1', unit: 'KILOGRAM' },
  { itemKey: 'egg', name: 'Egg', quantity: '1', unit: 'PIECE' },
];

function truncateUtf8(value: string, maximumBytes: number): string {
  if (byteLength(value) <= maximumBytes) return value;
  let output = '';
  for (const character of value) {
    if (byteLength(`${output}${character}…`) > maximumBytes) break;
    output += character;
  }
  return `${output}…`;
}

function defaultSpecification(): ItemSpecificationV1 {
  return { v: 1, category: 'OTHER' };
}

export function buildIngredientSuggestions(
  input: MenuDocumentV1,
  approvedMenus: readonly ApprovedMenuEvidence[] = [],
): Record<string, IngredientSuggestionDto[]> {
  const document = validateMenuDocument(input);
  const approved = approvedMenus.map((entry) => ({
    menuName: canonicalText(entry.menuName, 'Approved menu name', 160),
    document: validateMenuDocument(entry.document),
  }));
  const result: Record<string, IngredientSuggestionDto[]> = {};
  let ingredientSuggestionCount = 0;

  for (const dish of document.dishes) {
    const suggestions: IngredientSuggestionDto[] = [];
    const seen = new Set(dish.ingredients.map(({ itemKey: key }) => key));
    const addIngredient = (
      item: TemplateItem & { specification?: ItemSpecificationV1 },
      source: Exclude<SuggestionSource, 'MANUAL'>,
      sourceLabel: string,
      evidence: string,
    ) => {
      if (
        seen.has(item.itemKey) ||
        suggestions.length >= MENU_DOCUMENT_LIMITS.suggestionsPerDish ||
        ingredientSuggestionCount >= MENU_DOCUMENT_LIMITS.ingredientSuggestions
      ) {
        return;
      }
      seen.add(item.itemKey);
      ingredientSuggestionCount += 1;
      suggestions.push({
        id: `s-${dish.id}-${suggestions.length + 1}`,
        kind: 'INGREDIENT',
        itemKey: item.itemKey,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        specification: item.specification
          ? { v: 1, category: item.specification.category }
          : defaultSpecification(),
        source,
        sourceLabel: truncateUtf8(
          sourceLabel,
          MENU_DOCUMENT_LIMITS.sourceLabelBytes,
        ),
        evidence: truncateUtf8(evidence, MENU_DOCUMENT_LIMITS.evidenceBytes),
        selected: false,
      });
    };

    const dishNameKey = dish.name.toLocaleLowerCase('en-US');
    for (const approvedMenu of approved) {
      const approvedDish = approvedMenu.document.dishes.find(
        ({ name }) => name.toLocaleLowerCase('en-US') === dishNameKey,
      );
      if (!approvedDish) continue;
      for (const item of approvedDish.ingredients) {
        addIngredient(
          item,
          'APPROVED_SAME_DISH',
          `From your approved ${dish.name}`,
          `Previously approved in ${approvedMenu.menuName}.`,
        );
      }
    }

    for (const item of REVIEWED_TEMPLATES[dishNameKey] ?? []) {
      addIngredient(
        item,
        'REVIEWED_TEMPLATE',
        'From the reviewed Indian dish template',
        `Matched the reviewed template for ${dish.name}.`,
      );
    }

    const words = new Set(dishNameKey.split(/[^a-z0-9]+/).filter(Boolean));
    for (const item of DISH_NAME_ITEMS) {
      if (!words.has(item.itemKey)) continue;
      addIngredient(
        item,
        'DISH_NAME',
        'From words in this dish name',
        `The ingredient name appears directly in “${dish.name}”.`,
      );
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: `s-${dish.id}-manual`,
        kind: 'MANUAL_FALLBACK',
        source: 'MANUAL',
        sourceLabel: 'Enter ingredients manually',
        evidence:
          'No approved menu, reviewed template, or direct ingredient word matched this dish.',
        selected: false,
      });
    }
    result[dish.id] = suggestions;
  }

  assertBoundedJson(result, DOCUMENT_LIMITS.menu.jsonBytes, 'Menu suggestions');
  return result;
}
