import type { PrismaClient } from '@prisma/client';

import { validateAwardDocuments } from '@/lib/awards/award-document';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import type { ProcurementCategory } from '@/lib/domain/procurement-categories';
import { prisma } from '@/lib/prisma';
import { validateRequestItems } from '@/lib/procurement/request-document';
import {
  type SupplierCapabilitiesV1,
  validateSupplierCapabilities,
} from '@/lib/suppliers/supplier-capabilities';

export const SUPPLIER_SUGGESTION_LIMITS = {
  candidates: 50,
  perItem: 5,
  priorAwards: 50,
} as const;

type SuggestionActor = { tenantId: string; userId: string };
type SuggestionClient = TenantTransactionHost & Pick<PrismaClient, '$queryRaw'>;
type SuggestionItem = { id: string; itemKey: string; category: ProcurementCategory };
type CandidateSupplier = {
  id: string;
  businessName: string;
  capabilities: SupplierCapabilitiesV1;
};

export type SupplierSuggestion = {
  supplierId: string;
  businessName: string;
  reason: string;
  selected: false;
};

export class SupplierSuggestionsNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super('Procurement request not found.');
    this.name = 'SupplierSuggestionsNotFoundError';
  }
}

function validId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function evidence(
  item: SuggestionItem,
  supplier: CandidateSupplier,
  priorSupplierIds: ReadonlySet<string>,
) {
  const itemTier = supplier.capabilities.items.find(({ itemKey }) =>
    itemKey === item.itemKey)?.tier;
  const categoryTier = supplier.capabilities.categories.find(({ category }) =>
    category === item.category)?.tier;
  const values = [
    itemTier === 'PREFERRED',
    itemTier === 'BACKUP',
    categoryTier === 'PREFERRED',
    categoryTier === 'BACKUP',
    categoryTier === 'CAPABLE',
    priorSupplierIds.has(supplier.id),
  ];
  const reason = [
    'Preferred for this item',
    'Backup for this item',
    'Preferred for this category',
    'Backup for this category',
    'Listed for this category',
    'Supplied this item in a prior award',
  ][values.findIndex(Boolean)];
  return reason ? { values, reason } : null;
}

function compareNames(
  left: Pick<CandidateSupplier, 'businessName' | 'id'>,
  right: Pick<CandidateSupplier, 'businessName' | 'id'>,
) {
  return left.businessName.localeCompare(right.businessName, 'en-IN') ||
    left.id.localeCompare(right.id, 'en-IN');
}

export function rankSupplierSuggestions(input: {
  items: SuggestionItem[];
  suppliers: CandidateSupplier[];
  priorAwardSupplierIdsByItemKey: ReadonlyMap<string, ReadonlySet<string>>;
}): Record<string, SupplierSuggestion[]> {
  const candidates = [...input.suppliers]
    .sort(compareNames)
    .slice(0, SUPPLIER_SUGGESTION_LIMITS.candidates);
  return Object.fromEntries(input.items.map((item) => {
    const priorSupplierIds = input.priorAwardSupplierIdsByItemKey.get(item.itemKey) ?? new Set();
    const ranked = candidates.flatMap((supplier) => {
      const match = evidence(item, supplier, priorSupplierIds);
      return match ? [{ supplier, ...match }] : [];
    }).sort((left, right) => {
      for (let index = 0; index < left.values.length; index += 1) {
        if (left.values[index] !== right.values[index]) return left.values[index] ? -1 : 1;
      }
      return compareNames(left.supplier, right.supplier);
    }).slice(0, SUPPLIER_SUGGESTION_LIMITS.perItem);
    return [item.id, ranked.map(({ supplier, reason }) => ({
      supplierId: supplier.id,
      businessName: supplier.businessName,
      reason,
      selected: false as const,
    }))];
  }));
}

function priorSupplierIds(awards: Array<{
  allocationLines: unknown;
  supplierSnapshots: unknown;
  deliverySnapshot: unknown;
  totalPaise: bigint;
}>) {
  const byItemKey = new Map<string, Set<string>>();
  for (const award of awards) {
    const documents = validateAwardDocuments(award);
    for (const supplier of documents.supplierSnapshots.suppliers) {
      for (const line of supplier.lines) {
        const suppliers = byItemKey.get(line.itemKey) ?? new Set<string>();
        suppliers.add(supplier.supplierId);
        byItemKey.set(line.itemKey, suppliers);
      }
    }
  }
  return byItemKey;
}

export async function getSupplierSuggestions(
  input: { actor: SuggestionActor; requestId: string },
  client: SuggestionClient = prisma,
) {
  if (!validId(input.actor?.tenantId) || !validId(input.actor?.userId)) {
    throw new AuthorizationError();
  }
  if (!validId(input.requestId)) throw new SupplierSuggestionsNotFoundError();
  return withTenant(input.actor.tenantId, async (transaction) => {
    const actor = await transaction.user.findFirst({
      where: {
        id: input.actor.userId,
        tenantId: input.actor.tenantId,
        isActive: true,
        accountState: 'ACTIVE',
        tenant: { isActive: true },
      },
      select: { id: true },
    });
    if (!actor) throw new AuthorizationError();
    const request = await transaction.procurementRequest.findFirst({
      where: { id: input.requestId, tenantId: input.actor.tenantId },
      select: { id: true, version: true, items: true },
    });
    if (!request) throw new SupplierSuggestionsNotFoundError();
    const [suppliers, awards] = await Promise.all([
      transaction.supplier.findMany({
        where: {
          tenantId: input.actor.tenantId,
          isActive: true,
          verificationStatus: 'VERIFIED',
          relationshipType: { in: ['CURRENT', 'SELECTED_NEW'] },
        },
        orderBy: [{ businessName: 'asc' }, { id: 'asc' }],
        take: SUPPLIER_SUGGESTION_LIMITS.candidates,
        select: { id: true, businessName: true, capabilities: true },
      }),
      transaction.award.findMany({
        where: { tenantId: input.actor.tenantId, requestId: { not: request.id } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SUPPLIER_SUGGESTION_LIMITS.priorAwards,
        select: {
          allocationLines: true,
          supplierSnapshots: true,
          deliverySnapshot: true,
          totalPaise: true,
        },
      }),
    ]);
    const items = validateRequestItems(request.items).items;
    return {
      requestId: request.id,
      requestVersion: request.version,
      suggestionsByItemId: rankSupplierSuggestions({
        items: items.map((item) => ({
          id: item.id,
          itemKey: item.itemKey,
          category: item.specification.category,
        })),
        suppliers: suppliers.map((supplier) => ({
          ...supplier,
          capabilities: validateSupplierCapabilities(supplier.capabilities),
        })),
        priorAwardSupplierIdsByItemKey: priorSupplierIds(awards),
      }),
    };
  }, client);
}
