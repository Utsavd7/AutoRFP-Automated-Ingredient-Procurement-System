import type { PrismaClient } from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import type { ItemSpecificationV1 } from '@/lib/domain/item-specification';
import type { ProcurementUnit } from '@/lib/domain/quantity';
import {
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  MAX_SIGNED_BIGINT,
  parseUnsignedFixed,
} from '@/lib/domain/validation';
import {
  RequestDocumentValidationError,
  validateRequestDocuments,
} from '@/lib/procurement/request-document';
import { prisma } from '@/lib/prisma';
import { eligibleQuoteRequestItems } from '@/lib/quotes/public-quote-service';
import {
  latestQuoteRevision,
  PublicQuoteStorageCorruptionError,
  type QuoteRevisionItemV1,
  type QuoteRevisionV1,
  validateQuoteRevisionsDocument,
} from '@/lib/quotes/quote-revisions';

export class QuoteComparisonNotFoundError extends Error {
  readonly code = 'QUOTE_COMPARISON_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Procurement request not found.');
    this.name = 'QuoteComparisonNotFoundError';
  }
}

export type ComparisonRequestItem = {
  id: string;
  itemKey: string;
  name: string;
  quantity: string;
  unit: ProcurementUnit;
  specification: ItemSpecificationV1;
};

export type ComparisonRequest = {
  id: string;
  title: string;
  deliveryDate: string;
  quoteDeadline: string;
  commercialTerms: string | null;
  items: ComparisonRequestItem[];
};

export type ComparisonQuote = QuoteRevisionV1 & {
  supplierRequestId: string;
  supplierName: string;
  supplierActive: boolean;
  eligibleRequestItemIds: string[];
};

type StandardUnit = {
  dimension: 'MASS' | 'VOLUME' | 'COUNT';
  baseFactor: bigint;
};

const STANDARD_UNITS: Partial<Record<ProcurementUnit, StandardUnit>> = {
  KILOGRAM: { dimension: 'MASS', baseFactor: BigInt(1_000) },
  GRAM: { dimension: 'MASS', baseFactor: BigInt(1) },
  LITRE: { dimension: 'VOLUME', baseFactor: BigInt(1_000) },
  MILLILITRE: { dimension: 'VOLUME', baseFactor: BigInt(1) },
  PIECE: { dimension: 'COUNT', baseFactor: BigInt(1) },
};

function currentIndiaDate(now: Date) {
  return new Date(now.getTime() + 330 * 60 * 1_000).toISOString().slice(0, 10);
}

function exactDivide(numerator: bigint, denominator: bigint) {
  if (denominator <= BigInt(0) || numerator < BigInt(0)) return null;
  return numerator % denominator === BigInt(0) ? numerator / denominator : null;
}

export function normalizeQuoteQuantityMilli(
  quantity: string,
  fromUnit: ProcurementUnit,
  toUnit: ProcurementUnit,
) {
  const quantityMilli = parseUnsignedFixed(quantity, {
    label: 'Available quantity',
    scale: 3,
    maximumScaled: MAX_DECIMAL_18_3_SCALED,
    allowZero: false,
  });
  if (fromUnit === toUnit) return quantityMilli;
  const from = STANDARD_UNITS[fromUnit];
  const to = STANDARD_UNITS[toUnit];
  if (!from || !to || from.dimension !== to.dimension) return null;
  const normalized = exactDivide(quantityMilli * from.baseFactor, to.baseFactor);
  return normalized !== null && normalized <= MAX_DECIMAL_18_3_SCALED
    ? normalized
    : null;
}

export function normalizeQuoteUnitRatePaise(
  unitRatePaise: bigint,
  fromUnit: ProcurementUnit,
  toUnit: ProcurementUnit,
) {
  if (unitRatePaise < BigInt(0) || unitRatePaise > MAX_SIGNED_BIGINT) return null;
  if (fromUnit === toUnit) return unitRatePaise;
  const from = STANDARD_UNITS[fromUnit];
  const to = STANDARD_UNITS[toUnit];
  if (!from || !to || from.dimension !== to.dimension) return null;
  const normalized = exactDivide(unitRatePaise * to.baseFactor, from.baseFactor);
  return normalized !== null && normalized <= MAX_SIGNED_BIGINT ? normalized : null;
}

function requestDto(request: ComparisonRequest) {
  return {
    id: request.id,
    title: request.title,
    deliveryDate: request.deliveryDate,
    quoteDeadline: request.quoteDeadline,
    commercialTerms: request.commercialTerms,
    itemCount: request.items.length,
    items: request.items.map((item) => ({ ...item })),
  };
}

function suppliedSpecification(item: QuoteRevisionItemV1 | undefined) {
  return {
    brand: item?.suppliedBrand ?? null,
    packSize: item?.suppliedPackSize ?? null,
    qualityGrade: item?.suppliedQualityGrade ?? null,
  };
}

export function compareLatestQuotes(
  request: ComparisonRequest,
  quotes: ComparisonQuote[],
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const indiaToday = currentIndiaDate(now);
  const requestItems = new Map(request.items.map((item) => [item.id, item]));
  if (request.items.length === 0 || requestItems.size !== request.items.length) {
    throw new TypeError('Comparison requires unique requested items.');
  }

  const quoteDtos = quotes.map((quote) => {
    if (!Array.isArray(quote.eligibleRequestItemIds)) {
      throw new TypeError('Comparison quote eligibility must be an array.');
    }
    const eligibleRequestItemIds = new Set(quote.eligibleRequestItemIds);
    if (
      eligibleRequestItemIds.size === 0 ||
      eligibleRequestItemIds.size !== quote.eligibleRequestItemIds.length ||
      quote.eligibleRequestItemIds.some((itemId) => !requestItems.has(itemId))
    ) {
      throw new TypeError('Comparison quote eligibility must reference unique request items.');
    }
    const quoteItems = new Map<string, QuoteRevisionItemV1>();
    for (const item of quote.items) {
      if (
        quoteItems.has(item.requestItemId) ||
        !eligibleRequestItemIds.has(item.requestItemId)
      ) {
        throw new TypeError('Comparison quote items must match eligible request items.');
      }
      quoteItems.set(item.requestItemId, item);
    }
    const missingRequestItemIds: string[] = [];
    const partialRequestItemIds: string[] = [];
    const unitMismatchRequestItemIds: string[] = [];
    const substitutions: Array<{ requestItemId: string; text: string }> = [];
    let coveredItemCount = 0;

    const items = request.items.map((requestItem) => {
      const quoted = quoteItems.get(requestItem.id);
      const requestedMilli = parseUnsignedFixed(requestItem.quantity, {
        label: 'Requested quantity',
        scale: 3,
        maximumScaled: MAX_DECIMAL_18_3_SCALED,
        allowZero: false,
      });
      const common = {
        requestItemId: requestItem.id,
        requestItemKey: requestItem.itemKey,
        requestItemName: requestItem.name,
        requestedQuantity: requestItem.quantity,
        requestUnit: requestItem.unit,
        requestedSpecification: requestItem.specification,
        suppliedSpecification: suppliedSpecification(quoted),
      };
      if (!eligibleRequestItemIds.has(requestItem.id)) {
        return {
          ...common,
          quotedAvailableQuantity: null,
          quotedUnit: null,
          normalizedAvailableQuantity: null,
          normalizedUnitRatePaise: null,
          unitComparable: false,
          coverage: 'NOT_REQUESTED' as const,
          gstBasisPoints: null,
          taxInclusive: false,
          substitution: null,
          subtotalPaise: '0',
          gstPaise: '0',
          totalPaise: '0',
        };
      }
      if (
        !quoted ||
        quoted.noQuote ||
        quoted.availableQuantity === null ||
        quoted.unit === null ||
        quoted.unitRatePaise === null ||
        quoted.gstBasisPoints === null
      ) {
        missingRequestItemIds.push(requestItem.id);
        return {
          ...common,
          quotedAvailableQuantity: quoted?.availableQuantity ?? null,
          quotedUnit: quoted?.unit ?? null,
          normalizedAvailableQuantity: null,
          normalizedUnitRatePaise: null,
          unitComparable: false,
          coverage: 'MISSING' as const,
          gstBasisPoints: quoted?.gstBasisPoints ?? null,
          taxInclusive: quoted?.taxInclusive ?? false,
          substitution: quoted?.substitution ?? null,
          subtotalPaise: quoted?.subtotalPaise ?? '0',
          gstPaise: quoted?.gstPaise ?? '0',
          totalPaise: quoted?.totalPaise ?? '0',
        };
      }

      let availableMilli: bigint | null;
      let ratePaise: bigint | null;
      try {
        availableMilli = normalizeQuoteQuantityMilli(
          quoted.availableQuantity,
          quoted.unit,
          requestItem.unit,
        );
        ratePaise = normalizeQuoteUnitRatePaise(
          BigInt(quoted.unitRatePaise),
          quoted.unit,
          requestItem.unit,
        );
      } catch {
        availableMilli = null;
        ratePaise = null;
      }
      const unitComparable = availableMilli !== null && ratePaise !== null;
      let coverage: 'FULL' | 'PARTIAL' | 'UNIT_MISMATCH';
      if (!unitComparable) {
        coverage = 'UNIT_MISMATCH';
        unitMismatchRequestItemIds.push(requestItem.id);
      } else if (availableMilli !== null && availableMilli >= requestedMilli) {
        coverage = 'FULL';
        coveredItemCount += 1;
      } else {
        coverage = 'PARTIAL';
        partialRequestItemIds.push(requestItem.id);
      }
      if (quoted.substitution) {
        substitutions.push({
          requestItemId: requestItem.id,
          text: quoted.substitution,
        });
      }
      return {
        ...common,
        quotedAvailableQuantity: quoted.availableQuantity,
        quotedUnit: quoted.unit,
        normalizedAvailableQuantity:
          availableMilli === null ? null : formatScaledDecimal(availableMilli, 3),
        normalizedUnitRatePaise: ratePaise?.toString() ?? null,
        unitComparable,
        coverage,
        gstBasisPoints: quoted.gstBasisPoints,
        taxInclusive: quoted.taxInclusive,
        substitution: quoted.substitution,
        subtotalPaise: quoted.subtotalPaise,
        gstPaise: quoted.gstPaise,
        totalPaise: quoted.totalPaise,
      };
    });

    return {
      supplierRequestId: quote.supplierRequestId,
      supplierName: quote.supplierName,
      supplierActive: quote.supplierActive,
      revision: quote.revision,
      subtotalPaise: quote.subtotalPaise,
      gstPaise: quote.gstPaise,
      freightPaise: quote.freightPaise,
      totalPaise: quote.totalPaise,
      deliveryDate: quote.deliveryDate,
      validUntil: quote.validUntil,
      submittedAt: quote.submittedAt,
      minimumOrder: quote.minimumOrder,
      commercialTerms: quote.commercialTerms,
      notes: quote.notes,
      coveredItemCount,
      totalItemCount: eligibleRequestItemIds.size,
      fullCoverage: coveredItemCount === eligibleRequestItemIds.size,
      deliveryFit:
        quote.deliveryDate <= request.deliveryDate
          ? ('ON_OR_BEFORE' as const)
          : ('AFTER_REQUESTED_DATE' as const),
      expired: quote.validUntil < indiaToday,
      missingTerms: !quote.commercialTerms?.trim(),
      missingRequestItemIds,
      partialRequestItemIds,
      unitMismatchRequestItemIds,
      substitutions,
      items,
    };
  });

  quoteDtos.sort(
    (left, right) =>
      left.supplierName.localeCompare(right.supplierName, 'en-IN') ||
      left.supplierRequestId.localeCompare(right.supplierRequestId),
  );
  return { request: requestDto(request), quotes: quoteDtos };
}

type ComparisonClient = TenantTransactionHost &
  Pick<PrismaClient, '$queryRaw' | '$transaction'>;

function validId(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function storedRequestDocuments(items: unknown, sourcing: unknown) {
  try {
    return validateRequestDocuments(items, sourcing);
  } catch (error) {
    if (error instanceof RequestDocumentValidationError) {
      throw new PublicQuoteStorageCorruptionError();
    }
    throw error;
  }
}

export async function getQuoteComparison(
  input: {
    actor: { tenantId: string; userId: string };
    requestId: string;
  },
  client: ComparisonClient = prisma,
) {
  if (
    !validId(input.actor?.tenantId) ||
    !validId(input.actor?.userId) ||
    !validId(input.requestId)
  ) {
    throw new QuoteComparisonNotFoundError();
  }

  return withTenant(
    input.actor.tenantId,
    async (transaction) => {
      const actor = await transaction.user.findFirst({
        where: {
          tenantId: input.actor.tenantId,
          id: input.actor.userId,
          isActive: true,
          tenant: { isActive: true },
        },
        select: { id: true },
      });
      if (!actor) throw new AuthorizationError();

      const request = await transaction.procurementRequest.findFirst({
        where: { tenantId: input.actor.tenantId, id: input.requestId },
        select: {
          id: true,
          title: true,
          status: true,
          version: true,
          deliveryDate: true,
          quoteDeadline: true,
          commercialTerms: true,
          items: true,
          sourcing: true,
          award: {
            select: {
              id: true,
              requestId: true,
              rationale: true,
              allocationLines: true,
              supplierSnapshots: true,
              deliverySnapshot: true,
              totalPaise: true,
              createdAt: true,
            },
          },
          supplierRequests: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              supplierId: true,
              quoteRevision: true,
              quoteRevisions: true,
              supplier: {
                select: {
                  businessName: true,
                  isActive: true,
                  applicationRequestId: true,
                },
              },
            },
          },
        },
      });
      if (!request) throw new QuoteComparisonNotFoundError();
      const documents = storedRequestDocuments(request.items, request.sourcing);
      const comparisonRequest: ComparisonRequest = {
        id: request.id,
        title: request.title,
        deliveryDate: request.deliveryDate.toISOString().slice(0, 10),
        quoteDeadline: request.quoteDeadline.toISOString(),
        commercialTerms: request.commercialTerms,
        items: documents.items.items.map((item) => ({
          id: item.id,
          itemKey: item.itemKey,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          specification: item.specification,
        })),
      };
      const quotes = request.supplierRequests.flatMap<ComparisonQuote>(
        (supplierRequest) => {
          const eligibleItems = eligibleQuoteRequestItems({
            requestId: request.id,
            items: documents.items,
            sourcing: documents.sourcing,
            supplier: {
              id: supplierRequest.supplierId,
              applicationRequestId:
                supplierRequest.supplier.applicationRequestId,
            },
          });
          if (eligibleItems.length === 0) {
            throw new PublicQuoteStorageCorruptionError();
          }
          const revisions = validateQuoteRevisionsDocument(
            supplierRequest.quoteRevisions,
            eligibleItems,
          );
          if (
            !Number.isSafeInteger(supplierRequest.quoteRevision) ||
            supplierRequest.quoteRevision !== revisions.revisions.length
          ) {
            throw new PublicQuoteStorageCorruptionError();
          }
          const latest = latestQuoteRevision(revisions);
          return latest
            ? [
                {
                  supplierRequestId: supplierRequest.id,
                  supplierName: supplierRequest.supplier.businessName,
                  supplierActive: supplierRequest.supplier.isActive,
                  eligibleRequestItemIds: eligibleItems.map((item) => item.id),
                  ...latest,
                },
              ]
            : [];
        },
      );
      const compared = compareLatestQuotes(comparisonRequest, quotes);
      return {
        ...compared,
        request: {
          ...compared.request,
          status: request.status,
          version: request.version,
          award: request.award
            ? {
                id: request.award.id,
                requestId: request.award.requestId,
                rationale: request.award.rationale,
                allocationLines: request.award.allocationLines,
                suppliers: request.award.supplierSnapshots,
                deliverySnapshot: request.award.deliverySnapshot,
                totalPaise: request.award.totalPaise.toString(),
                createdAt: request.award.createdAt.toISOString(),
              }
            : null,
        },
      };
    },
    client,
  );
}
