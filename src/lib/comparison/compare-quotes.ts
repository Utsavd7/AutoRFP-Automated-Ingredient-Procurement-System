import {
  type PrismaClient,
  type ProcurementUnit,
} from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import {
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  MAX_SIGNED_BIGINT,
  parseUnsignedFixed,
} from '@/lib/domain/validation';
import { prisma } from '@/lib/prisma';

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
  name: string;
  quantity: string;
  unit: ProcurementUnit;
};

export type ComparisonRequest = {
  id: string;
  title: string;
  deliveryDate: Date;
  quoteDeadline: Date;
  commercialTerms: string | null;
  items: ComparisonRequestItem[];
};

export type ComparisonQuoteItem = {
  id: string;
  requestItemId: string;
  noQuote: boolean;
  availableQuantity: string | null;
  unit: ProcurementUnit | null;
  unitRatePaise: bigint | null;
  gstBasisPoints: number | null;
  taxInclusive: boolean;
  substitution: string | null;
  subtotalPaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
};

export type ComparisonQuote = {
  id: string;
  supplierRequestId: string;
  supplierId: string;
  supplierName: string;
  supplierActive: boolean;
  revision: number;
  subtotalPaise: bigint;
  gstPaise: bigint;
  freightPaise: bigint;
  totalPaise: bigint;
  deliveryDate: Date;
  validUntil: Date;
  commercialTerms: string | null;
  notes: string | null;
  submittedAt: Date;
  items: ComparisonQuoteItem[];
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

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

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
    deliveryDate: dateOnly(request.deliveryDate),
    quoteDeadline: request.quoteDeadline.toISOString(),
    commercialTerms: request.commercialTerms,
    itemCount: request.items.length,
    items: request.items.map((item) => ({ ...item })),
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
    const quoteItems = new Map(quote.items.map((item) => [item.requestItemId, item]));
    const missingRequestItemIds: string[] = [];
    const partialRequestItemIds: string[] = [];
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
          requestItemId: requestItem.id,
          requestItemName: requestItem.name,
          quoteItemId: quoted?.id ?? null,
          requestedQuantity: requestItem.quantity,
          requestUnit: requestItem.unit,
          quotedAvailableQuantity: quoted?.availableQuantity ?? null,
          quotedUnit: quoted?.unit ?? null,
          normalizedAvailableQuantity: null,
          normalizedUnitRatePaise: null,
          unitComparable: false,
          coverage: 'MISSING' as const,
          gstBasisPoints: quoted?.gstBasisPoints ?? null,
          taxInclusive: quoted?.taxInclusive ?? false,
          substitution: quoted?.substitution ?? null,
          subtotalPaise: quoted?.subtotalPaise.toString() ?? '0',
          gstPaise: quoted?.gstPaise.toString() ?? '0',
          totalPaise: quoted?.totalPaise.toString() ?? '0',
        };
      }

      let availableMilli: bigint | null = null;
      let ratePaise: bigint | null = null;
      try {
        availableMilli = normalizeQuoteQuantityMilli(
          quoted.availableQuantity,
          quoted.unit,
          requestItem.unit,
        );
        ratePaise = normalizeQuoteUnitRatePaise(
          quoted.unitRatePaise,
          quoted.unit,
          requestItem.unit,
        );
      } catch {
        availableMilli = null;
        ratePaise = null;
      }
      const unitComparable = availableMilli !== null && ratePaise !== null;
      let coverage: 'FULL' | 'PARTIAL' | 'UNIT_MISMATCH';
      if (availableMilli === null || ratePaise === null) {
        coverage = 'UNIT_MISMATCH';
      } else if (availableMilli >= requestedMilli) {
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
        requestItemId: requestItem.id,
        requestItemName: requestItem.name,
        quoteItemId: quoted.id,
        requestedQuantity: requestItem.quantity,
        requestUnit: requestItem.unit,
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
        subtotalPaise: quoted.subtotalPaise.toString(),
        gstPaise: quoted.gstPaise.toString(),
        totalPaise: quoted.totalPaise.toString(),
      };
    });

    const fullCoverage = coveredItemCount === request.items.length;
    const expired = dateOnly(quote.validUntil) < indiaToday;
    const awardIssues: Array<
      'SUPPLIER_INACTIVE' | 'QUOTE_EXPIRED' | 'INCOMPLETE_COVERAGE'
    > = [];
    if (!quote.supplierActive) awardIssues.push('SUPPLIER_INACTIVE');
    if (expired) awardIssues.push('QUOTE_EXPIRED');
    if (!fullCoverage) awardIssues.push('INCOMPLETE_COVERAGE');
    return {
      quoteId: quote.id,
      supplierRequestId: quote.supplierRequestId,
      supplierId: quote.supplierId,
      supplierName: quote.supplierName,
      supplierActive: quote.supplierActive,
      revision: quote.revision,
      subtotalPaise: quote.subtotalPaise.toString(),
      gstPaise: quote.gstPaise.toString(),
      freightPaise: quote.freightPaise.toString(),
      totalPaise: quote.totalPaise.toString(),
      deliveryDate: dateOnly(quote.deliveryDate),
      validUntil: dateOnly(quote.validUntil),
      submittedAt: quote.submittedAt.toISOString(),
      commercialTerms: quote.commercialTerms,
      notes: quote.notes,
      coveredItemCount,
      totalItemCount: request.items.length,
      fullCoverage,
      comparable: fullCoverage && !expired,
      awardable: awardIssues.length === 0,
      awardIssues,
      deliveryFit:
        dateOnly(quote.deliveryDate) <= dateOnly(request.deliveryDate)
          ? ('ON_OR_BEFORE' as const)
          : ('AFTER_REQUESTED_DATE' as const),
      expired,
      missingTerms: !quote.commercialTerms?.trim(),
      missingRequestItemIds,
      partialRequestItemIds,
      substitutions,
      items,
    };
  });

  quoteDtos.sort(
    (left, right) =>
      left.supplierName.localeCompare(right.supplierName, 'en-IN') ||
      left.supplierId.localeCompare(right.supplierId) ||
      left.quoteId.localeCompare(right.quoteId),
  );

  return { request: requestDto(request), quotes: quoteDtos };
}

type ComparisonClient = TenantTransactionHost & Pick<PrismaClient, '$queryRaw'>;

function validId(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export async function getQuoteComparison(input: {
  actor: { tenantId: string; userId: string };
  requestId: string;
}, client: ComparisonClient = prisma) {
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

      const [locked] = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "ProcurementRequest"
        WHERE "tenantId" = ${input.actor.tenantId}
          AND "id" = ${input.requestId}
        FOR SHARE
      `;
      if (!locked) throw new QuoteComparisonNotFoundError();

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
          items: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, quantity: true, unit: true },
          },
          award: {
            select: {
              id: true,
              requestId: true,
              rationale: true,
              supplierSnapshots: true,
              deliverySnapshot: true,
              totalPaise: true,
              createdAt: true,
              lines: {
                orderBy: [
                  { requestItemId: 'asc' },
                  { supplierId: 'asc' },
                  { supplierQuoteItemId: 'asc' },
                ],
                select: {
                  id: true,
                  requestItemId: true,
                  supplierQuoteItemId: true,
                  supplierId: true,
                  quantity: true,
                  unit: true,
                  unitRatePaise: true,
                  gstBasisPoints: true,
                  subtotalPaise: true,
                  gstPaise: true,
                  totalPaise: true,
                  requestItem: { select: { name: true } },
                },
              },
            },
          },
          supplierRequests: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              supplierId: true,
              supplier: { select: { businessName: true, isActive: true } },
              quotes: {
                orderBy: { revision: 'desc' },
                take: 1,
                select: {
                  id: true,
                  revision: true,
                  subtotalPaise: true,
                  gstPaise: true,
                  freightPaise: true,
                  totalPaise: true,
                  deliveryDate: true,
                  validUntil: true,
                  commercialTerms: true,
                  notes: true,
                  submittedAt: true,
                  items: {
                    orderBy: { requestItemId: 'asc' },
                    select: {
                      id: true,
                      requestItemId: true,
                      noQuote: true,
                      availableQuantity: true,
                      unit: true,
                      unitRatePaise: true,
                      gstBasisPoints: true,
                      taxInclusive: true,
                      substitution: true,
                      subtotalPaise: true,
                      gstPaise: true,
                      totalPaise: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!request || request.items.length === 0) {
        throw new QuoteComparisonNotFoundError();
      }

      const compared = compareLatestQuotes(
        {
          id: request.id,
          title: request.title,
          deliveryDate: request.deliveryDate,
          quoteDeadline: request.quoteDeadline,
          commercialTerms: request.commercialTerms,
          items: request.items.map((item) => ({
            ...item,
            quantity: item.quantity.toString(),
          })),
        },
        request.supplierRequests.flatMap((supplierRequest) => {
          const quote = supplierRequest.quotes[0];
          return quote
            ? [
                {
                  ...quote,
                  supplierRequestId: supplierRequest.id,
                  supplierId: supplierRequest.supplierId,
                  supplierName: supplierRequest.supplier.businessName,
                  supplierActive: supplierRequest.supplier.isActive,
                  items: quote.items.map((item) => ({
                    ...item,
                    availableQuantity: item.availableQuantity?.toString() ?? null,
                  })),
                },
              ]
            : [];
        }),
      );

      return {
        ...compared,
        request: {
          ...compared.request,
          status: request.status,
          version: request.version,
          award: request.award
            ? (() => {
                if (!Array.isArray(request.award.supplierSnapshots)) {
                  throw new TypeError('Award supplier snapshots are not an array.');
                }
                return {
                  id: request.award.id,
                  requestId: request.award.requestId,
                  rationale: request.award.rationale,
                  totalPaise: request.award.totalPaise.toString(),
                  createdAt: request.award.createdAt.toISOString(),
                  splitAward: request.award.supplierSnapshots.length > 1,
                  suppliers: request.award.supplierSnapshots,
                  deliverySnapshot: request.award.deliverySnapshot,
                  lines: request.award.lines.map((line) => ({
                    id: line.id,
                    requestItemId: line.requestItemId,
                    requestItemName: line.requestItem.name,
                    supplierQuoteItemId: line.supplierQuoteItemId,
                    supplierId: line.supplierId,
                    quantity: line.quantity.toString(),
                    unit: line.unit,
                    unitRatePaise: line.unitRatePaise.toString(),
                    gstBasisPoints: line.gstBasisPoints,
                    subtotalPaise: line.subtotalPaise.toString(),
                    gstPaise: line.gstPaise.toString(),
                    totalPaise: line.totalPaise.toString(),
                  })),
                };
              })()
            : null,
        },
      };
    },
    client,
  );
}
