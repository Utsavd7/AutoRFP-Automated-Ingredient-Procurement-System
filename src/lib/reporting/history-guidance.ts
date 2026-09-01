import type { ProcurementUnit } from '@/lib/domain/quantity';
import { parseQuantityToMilli } from '@/lib/domain/quantity';

export const HISTORY_GUIDANCE_LIMITS = {
  awards: 50,
  items: 50,
  unusualSamples: 4,
} as const;

type CurrentItem = {
  itemKey: string;
  itemName: string;
  quantity: string;
  unit: ProcurementUnit;
};

type HistoricalAward = {
  id: string;
  createdAt: Date;
  allocationLines: {
    lines: Array<{
      requestItemId: string;
      supplierRequestId: string;
      supplierId: string;
      quoteRevision: number;
      quantity: string;
      unit: ProcurementUnit;
    }>;
  };
  supplierSnapshots: {
    suppliers: Array<{
      supplierId: string;
      supplierRequestId: string;
      quoteRevision: number;
      supplierName: string;
      lines: Array<{
        requestItemId: string;
        itemKey: string;
        itemName: string;
        requestedQuantity: string;
        requestedUnit: ProcurementUnit;
      }>;
    }>;
  };
};

export type ItemHistoryGuidance = {
  itemKey: string;
  itemName: string;
  unit: ProcurementUnit;
  lastOrderedQuantity: string | null;
  lastOrderedAt: string | null;
  lastSupplierNames: string[];
  seasonalNotice: string | null;
  unusualQuantityNotice: string | null;
};

const REVIEWED_PRODUCE_SEASONS = new Map<string, string>([
  ['mango', 'March–July'],
  ['lychee', 'April–June'],
  ['strawberry', 'November–March'],
  ['green-peas', 'November–February'],
]);

function compareAwards(left: HistoricalAward, right: HistoricalAward) {
  return right.createdAt.getTime() - left.createdAt.getTime() ||
    right.id.localeCompare(left.id, 'en-IN');
}

function awardObservation(
  award: HistoricalAward,
  itemKey: string,
  unit: ProcurementUnit,
) {
  const descriptions = award.supplierSnapshots.suppliers.flatMap((supplier) =>
    supplier.lines
      .filter((line) => line.itemKey === itemKey && line.requestedUnit === unit)
      .map((line) => ({ supplier, line })),
  );
  const first = descriptions[0]?.line;
  if (!first) return null;

  const supplierNames = new Set<string>();
  for (const { supplier, line } of descriptions) {
    const allocated = award.allocationLines.lines.some((allocation) =>
      allocation.requestItemId === line.requestItemId &&
      allocation.supplierId === supplier.supplierId &&
      allocation.supplierRequestId === supplier.supplierRequestId &&
      allocation.quoteRevision === supplier.quoteRevision &&
      allocation.unit === unit,
    );
    if (allocated) supplierNames.add(supplier.supplierName);
  }
  return {
    quantity: first.requestedQuantity,
    quantityMilli: parseQuantityToMilli(first.requestedQuantity),
    supplierNames: [...supplierNames].sort((left, right) =>
      left.localeCompare(right, 'en-IN')),
  };
}

function unusualNotice(current: string, history: bigint[]) {
  if (history.length < HISTORY_GUIDANCE_LIMITS.unusualSamples) return null;
  const currentMilli = parseQuantityToMilli(current);
  const minimum = history.reduce((value, entry) => entry < value ? entry : value);
  const maximum = history.reduce((value, entry) => entry > value ? entry : value);
  if (currentMilli > maximum * BigInt(2)) {
    return `Quantity check: this is more than twice the largest of ${history.length} same-unit prior awards.`;
  }
  if (currentMilli * BigInt(2) < minimum) {
    return `Quantity check: this is less than half the smallest of ${history.length} same-unit prior awards.`;
  }
  return null;
}

function seasonalNotice(itemKey: string, itemName: string) {
  const window = REVIEWED_PRODUCE_SEASONS.get(itemKey);
  return window
    ? `Seasonality check: ${itemName} has a ${window} India review window; confirm current availability with suppliers.`
    : null;
}

export function buildHistoryGuidance(input: {
  items: CurrentItem[];
  awards: HistoricalAward[];
}): ItemHistoryGuidance[] {
  const awards = [...input.awards]
    .sort(compareAwards)
    .slice(0, HISTORY_GUIDANCE_LIMITS.awards);
  const seen = new Set<string>();
  return input.items.flatMap((item) => {
    const identity = `${item.itemKey}\u0000${item.unit}`;
    if (seen.has(identity) || seen.size >= HISTORY_GUIDANCE_LIMITS.items) return [];
    seen.add(identity);
    const observations = awards.flatMap((award) => {
      const observation = awardObservation(award, item.itemKey, item.unit);
      return observation ? [{ award, observation }] : [];
    });
    const last = observations[0];
    return [{
      itemKey: item.itemKey,
      itemName: item.itemName,
      unit: item.unit,
      lastOrderedQuantity: last?.observation.quantity ?? null,
      lastOrderedAt: last?.award.createdAt.toISOString() ?? null,
      lastSupplierNames: last?.observation.supplierNames ?? [],
      seasonalNotice: seasonalNotice(item.itemKey, item.itemName),
      unusualQuantityNotice: unusualNotice(
        item.quantity,
        observations.map(({ observation }) => observation.quantityMilli),
      ),
    }];
  });
}
