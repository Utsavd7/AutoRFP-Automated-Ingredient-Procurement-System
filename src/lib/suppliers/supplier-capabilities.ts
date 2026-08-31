import { assertBoundedJson } from '@/lib/domain/postgres-json';
import {
  PROCUREMENT_CATEGORIES,
  type ProcurementCategory,
} from '@/lib/domain/procurement-categories';

export const SUPPLIER_CAPABILITIES_LIMITS = {
  documentBytes: 64 * 1_024,
  categories: 22,
  items: 250,
  itemKeyBytes: 80,
  itemNameBytes: 160,
} as const;

export type SupplierCategoryTier = 'CAPABLE' | 'PREFERRED' | 'BACKUP';
export type SupplierItemTier = 'PREFERRED' | 'BACKUP';

export type SupplierCapabilitiesV1 = {
  v: 1;
  categories: Array<{
    category: ProcurementCategory;
    tier: SupplierCategoryTier;
    rank: number;
  }>;
  items: Array<{
    itemKey: string;
    itemName: string;
    tier: SupplierItemTier;
    rank: number;
  }>;
};

const ROOT_KEYS = new Set(['v', 'categories', 'items']);
const CATEGORY_KEYS = new Set(['category', 'tier', 'rank']);
const ITEM_KEYS = new Set(['itemKey', 'itemName', 'tier', 'rank']);
const CATEGORY_TIERS = ['CAPABLE', 'PREFERRED', 'BACKUP'] as const;
const ITEM_TIERS = ['PREFERRED', 'BACKUP'] as const;
const categoryOrder = new Map(
  Object.keys(PROCUREMENT_CATEGORIES).map((category, index) => [category, index]),
);

export class SupplierCapabilitiesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupplierCapabilitiesValidationError';
  }
}

function fail(message: string): never {
  throw new SupplierCapabilitiesValidationError(message);
}

function plainRecord(
  input: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    fail(`${label} must be a plain JSON object.`);
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      fail(`${label} contains unknown key ${String(key)}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail(`${label} key ${key} must be an enumerable data property.`);
    }
  }
  return input as Record<string, unknown>;
}

function boundedArray(input: unknown, label: string, maximum: number): unknown[] {
  if (
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > maximum
  ) {
    fail(`${label} must be an array with at most ${maximum} entries.`);
  }
  return input;
}

function positiveRank(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function boundedCanonicalText(
  value: unknown,
  label: string,
  maximumBytes: number,
): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    fail(`${label} must be canonical text of ${maximumBytes} UTF-8 bytes or fewer.`);
  }
  return value;
}

function supportedTier<T extends string>(
  value: unknown,
  tiers: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !(tiers as readonly string[]).includes(value)) {
    fail(`${label} is not supported.`);
  }
  return value as T;
}

export function emptySupplierCapabilities(): SupplierCapabilitiesV1 {
  return { v: 1, categories: [], items: [] };
}

export function validateSupplierCapabilities(input: unknown): SupplierCapabilitiesV1 {
  const root = plainRecord(input, 'Supplier capabilities', ROOT_KEYS);
  if (root.v !== 1) fail('Supplier capabilities version must be 1.');

  const categoryRanks = new Map<SupplierCategoryTier, Set<number>>(
    CATEGORY_TIERS.map((tier) => [tier, new Set<number>()]),
  );
  const seenCategories = new Set<ProcurementCategory>();
  const categories = boundedArray(
    root.categories,
    'Supplier capability categories',
    SUPPLIER_CAPABILITIES_LIMITS.categories,
  ).map((value, index) => {
    const entry = plainRecord(value, `Supplier category ${index + 1}`, CATEGORY_KEYS);
    if (
      typeof entry.category !== 'string' ||
      !Object.prototype.hasOwnProperty.call(PROCUREMENT_CATEGORIES, entry.category)
    ) {
      fail(`Supplier category ${index + 1} is not supported.`);
    }
    const category = entry.category as ProcurementCategory;
    if (seenCategories.has(category)) {
      fail('A supplier category may appear in only one capability tier.');
    }
    seenCategories.add(category);
    const tier = supportedTier(entry.tier, CATEGORY_TIERS, `Supplier category ${index + 1} tier`);
    const rank = positiveRank(entry.rank, `Supplier category ${index + 1} rank`);
    const ranks = categoryRanks.get(tier)!;
    if (ranks.has(rank)) fail(`Supplier category ${tier} ranks must be unique.`);
    ranks.add(rank);
    return { category, tier, rank };
  });

  const itemRanks = new Map<SupplierItemTier, Set<number>>(
    ITEM_TIERS.map((tier) => [tier, new Set<number>()]),
  );
  const seenItems = new Set<string>();
  const items = boundedArray(
    root.items,
    'Supplier item preferences',
    SUPPLIER_CAPABILITIES_LIMITS.items,
  ).map((value, index) => {
    const entry = plainRecord(value, `Supplier item ${index + 1}`, ITEM_KEYS);
    const itemKey = boundedCanonicalText(
      entry.itemKey,
      `Supplier item ${index + 1} itemKey`,
      SUPPLIER_CAPABILITIES_LIMITS.itemKeyBytes,
    );
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(itemKey)) {
      fail(`Supplier item ${index + 1} itemKey must be a stable lowercase item key.`);
    }
    if (seenItems.has(itemKey)) fail('A normalized supplier item may appear only once.');
    seenItems.add(itemKey);
    const itemName = boundedCanonicalText(
      entry.itemName,
      `Supplier item ${index + 1} itemName`,
      SUPPLIER_CAPABILITIES_LIMITS.itemNameBytes,
    );
    const tier = supportedTier(entry.tier, ITEM_TIERS, `Supplier item ${index + 1} tier`);
    const rank = positiveRank(entry.rank, `Supplier item ${index + 1} rank`);
    const ranks = itemRanks.get(tier)!;
    if (ranks.has(rank)) fail(`Supplier item ${tier} ranks must be unique.`);
    ranks.add(rank);
    return { itemKey, itemName, tier, rank };
  });

  categories.sort((left, right) =>
    CATEGORY_TIERS.indexOf(left.tier) - CATEGORY_TIERS.indexOf(right.tier) ||
    left.rank - right.rank ||
    categoryOrder.get(left.category)! - categoryOrder.get(right.category)!);
  items.sort((left, right) =>
    ITEM_TIERS.indexOf(left.tier) - ITEM_TIERS.indexOf(right.tier) ||
    left.rank - right.rank || left.itemKey.localeCompare(right.itemKey, 'en'));

  const document: SupplierCapabilitiesV1 = { v: 1, categories, items };
  try {
    assertBoundedJson(
      document,
      SUPPLIER_CAPABILITIES_LIMITS.documentBytes,
      'Supplier capabilities',
    );
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
    fail('Supplier capabilities exceed the 64 KiB JSON limit.');
  }
  return document;
}
