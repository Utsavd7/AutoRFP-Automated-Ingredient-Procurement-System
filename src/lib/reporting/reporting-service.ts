import { type PrismaClient, type ProcurementUnit } from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import { normalizeQuoteQuantityMilli, normalizeQuoteUnitRatePaise } from '@/lib/comparison/compare-quotes';
import { type TenantTransactionHost, withTenant } from '@/lib/db/tenant-transaction';
import { formatScaledDecimal, MAX_DECIMAL_18_3_SCALED, parseUnsignedFixed } from '@/lib/domain/validation';
import { prisma } from '@/lib/prisma';

export const REPORTING_LIMITS = {
  historyPage: 50,
  insightRequests: 50,
  recentHistoryRecords: 25,
  cursorBytes: 1_024,
} as const;

export class ReportingValidationError extends Error {
  readonly code = 'INVALID_REPORTING_REQUEST';
  readonly status = 422;

  constructor(readonly errors: Record<string, string[]>) {
    super('The reporting request contains invalid or unbounded fields.');
    this.name = 'ReportingValidationError';
  }
}

type ReportingActor = { tenantId: string; userId: string };
type ReportingClient = TenantTransactionHost & Pick<PrismaClient, '$queryRaw'>;

type InsightRequest = {
  id: string;
  title: string;
  status: string;
  openedAt: Date | null;
  items: Array<{ id: string; name: string; quantity: string; unit: ProcurementUnit }>;
  supplierRequests: Array<{
    id: string;
    supplierId: string;
    supplierName: string;
    latestQuote: null | {
      id: string;
      submittedAt: Date;
      items: Array<{
        requestItemId: string;
        noQuote: boolean;
        availableQuantity: string | null;
        unit: ProcurementUnit | null;
        unitRatePaise: string | null;
      }>;
    };
  }>;
};

function percentage(numerator: number, denominator: number) {
  if (denominator === 0) return null;
  const tenths = Math.round((numerator * 1_000) / denominator);
  return formatScaledDecimal(BigInt(tenths), 1);
}

function variancePercent(minimum: bigint, maximum: bigint) {
  if (minimum <= BigInt(0) || maximum < minimum) return null;
  const hundredths = ((maximum - minimum) * BigInt(10_000) + minimum / BigInt(2)) / minimum;
  return formatScaledDecimal(hundredths, 2);
}

export function buildFactualInsights(input: {
  requests: InsightRequest[];
  awardedRequestCount: number;
  totalAwardedPaise: string;
  capped: boolean;
  generatedAt: Date;
}) {
  let supplierRequestsSent = 0;
  let supplierResponses = 0;
  let quoteLinesExpected = 0;
  let quoteLinesFullyCovered = 0;
  const ranges = new Map<string, {
    itemName: string;
    unit: ProcurementUnit;
    quotes: Map<string, { rate: bigint; supplierName: string }>;
  }>();

  for (const request of input.requests) {
    const requestItems = new Map(request.items.map((item) => [item.id, item]));
    supplierRequestsSent += request.supplierRequests.length;
    for (const supplierRequest of request.supplierRequests) {
      const quote = supplierRequest.latestQuote;
      if (!quote) continue;
      supplierResponses += 1;
      const quoteItems = new Map(quote.items.map((item) => [item.requestItemId, item]));
      for (const requestItem of request.items) {
        quoteLinesExpected += 1;
        const quoted = quoteItems.get(requestItem.id);
        if (
          !quoted || quoted.noQuote || quoted.availableQuantity === null ||
          quoted.unit === null || quoted.unitRatePaise === null
        ) continue;
        let available: bigint | null = null;
        let rate: bigint | null = null;
        try {
          available = normalizeQuoteQuantityMilli(
            quoted.availableQuantity,
            quoted.unit,
            requestItem.unit,
          );
          rate = normalizeQuoteUnitRatePaise(
            BigInt(quoted.unitRatePaise),
            quoted.unit,
            requestItem.unit,
          );
        } catch {
          available = null;
          rate = null;
        }
        if (available === null || rate === null) continue;
        const requested = parseUnsignedFixed(requestItem.quantity, {
          label: 'Requested quantity', scale: 3,
          maximumScaled: MAX_DECIMAL_18_3_SCALED, allowZero: false,
        });
        if (available >= requested) quoteLinesFullyCovered += 1;
        const normalizedName = requestItem.name.trim().toLocaleLowerCase('en-IN');
        const key = `${normalizedName}\u0000${requestItem.unit}`;
        const range = ranges.get(key) ?? {
          itemName: requestItem.name.trim(),
          unit: requestItem.unit,
          quotes: new Map(),
        };
        range.quotes.set(quote.id, { rate, supplierName: supplierRequest.supplierName });
        ranges.set(key, range);
      }
      for (const quoteItem of quote.items) {
        if (!requestItems.has(quoteItem.requestItemId)) continue;
      }
    }
  }

  const priceRanges = [...ranges.values()].flatMap((range) => {
    const quotes = [...range.quotes.values()];
    if (quotes.length < 2) return [];
    quotes.sort((left, right) => left.rate < right.rate ? -1 : left.rate > right.rate ? 1 : left.supplierName.localeCompare(right.supplierName, 'en-IN'));
    const minimum = quotes[0];
    const maximum = quotes.at(-1)!;
    return [{
      itemName: range.itemName,
      unit: range.unit,
      quoteCount: quotes.length,
      minimumUnitRatePaise: minimum.rate.toString(),
      maximumUnitRatePaise: maximum.rate.toString(),
      minimumSupplierName: minimum.supplierName,
      maximumSupplierName: maximum.supplierName,
      observedVariancePercent: variancePercent(minimum.rate, maximum.rate),
    }];
  }).sort((left, right) =>
    right.quoteCount - left.quoteCount ||
    left.itemName.localeCompare(right.itemName, 'en-IN') ||
    left.unit.localeCompare(right.unit),
  ).slice(0, 20);

  return {
    generatedAt: input.generatedAt.toISOString(),
    capped: input.capped,
    summary: {
      requestSampleSize: input.requests.length,
      supplierRequestsSent,
      supplierResponses,
      responseRatePercent: percentage(supplierResponses, supplierRequestsSent),
      quoteLinesExpected,
      quoteLinesFullyCovered,
      quotedLineCoveragePercent: percentage(quoteLinesFullyCovered, quoteLinesExpected),
      awardedRequestCount: input.awardedRequestCount,
      totalAwardedPaise: input.totalAwardedPaise,
    },
    priceRanges,
    notes: [
      `Response and coverage use the latest submitted quote from up to ${REPORTING_LIMITS.insightRequests} recent open or awarded requests.`,
      'Observed ranges compare submitted quotes; they are not savings claims or automatic recommendations.',
    ],
  };
}

function validId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

const historyActivityLabels = {
  'member.invited': () => 'Team invitation created',
  'member.invitation-revoked': () => 'Team invitation cancelled',
  'member.joined': () => 'Team member joined',
  'member.deactivated': () => 'Team member deactivated',
  'workspace.updated': () => 'Restaurant details updated',
  'menu.approved': () => 'Menu approved',
  'supplier.created': () => 'Supplier added',
  'request.opened': () => 'Request sent to suppliers',
  'supplier-link.created': () => 'Supplier quote link created',
  'supplier-link.revoked': () => 'Supplier quote link closed',
  'quote.submitted': (metadata: unknown) => {
    const revision = metadata && typeof metadata === 'object' && 'revision' in metadata
      ? (metadata as { revision?: unknown }).revision
      : null;
    return Number.isSafeInteger(revision) && Number(revision) > 0
      ? `Supplier sent quote version ${revision}`
      : 'Supplier sent a quote';
  },
  'request.awarded': () => 'Award recorded',
  'request.cancelled': () => 'Request cancelled',
  'request.repeated': () => 'Request copied into a new draft',
  'audit.export': () => 'Procurement record downloaded',
} as const;

type HistoryAuditRecord = {
  id: string;
  action: string;
  entityType: string;
  createdAt: Date;
  actor: { name: string } | null;
  metadata: unknown;
};

export function buildHistoryActivity(records: HistoryAuditRecord[]) {
  return records.flatMap((record) => {
    const label = historyActivityLabels[record.action as keyof typeof historyActivityLabels];
    if (!label) return [];
    return [{
      id: record.id,
      label: label(record.metadata),
      actorName: record.actor?.name.trim() || (record.action === 'quote.submitted' ? 'Supplier' : 'System'),
      createdAt: record.createdAt.toISOString(),
    }];
  });
}

function validateActor(actor: ReportingActor) {
  if (!validId(actor?.tenantId) || !validId(actor?.userId)) throw new AuthorizationError();
  return actor;
}

async function requireActor(transaction: Parameters<Parameters<typeof withTenant>[1]>[0], actor: ReportingActor) {
  const user = await transaction.user.findFirst({
    where: { id: actor.userId, tenantId: actor.tenantId, isActive: true, tenant: { isActive: true } },
    select: { id: true },
  });
  if (!user) throw new AuthorizationError();
}

export async function getFactualInsights(
  input: { actor: ReportingActor },
  client: ReportingClient = prisma,
) {
  const actor = validateActor(input.actor);
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActor(transaction, actor);
    const [requests, awards, clock] = await Promise.all([
      transaction.procurementRequest.findMany({
        where: { tenantId: actor.tenantId, status: { in: ['OPEN', 'AWARDED'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: REPORTING_LIMITS.insightRequests + 1,
        select: {
          id: true, title: true, status: true, openedAt: true,
          items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true, quantity: true, unit: true } },
          supplierRequests: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true, supplierId: true, supplier: { select: { businessName: true } },
              quotes: {
                orderBy: [{ revision: 'desc' }], take: 1,
                select: {
                  id: true, submittedAt: true,
                  items: { select: { requestItemId: true, noQuote: true, availableQuantity: true, unit: true, unitRatePaise: true } },
                },
              },
            },
          },
        },
      }),
      transaction.award.aggregate({
        where: { tenantId: actor.tenantId },
        _count: { _all: true },
        _sum: { totalPaise: true },
      }),
      transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`,
    ]);
    const capped = requests.length > REPORTING_LIMITS.insightRequests;
    if (capped) requests.pop();
    const generatedAt = clock[0]?.now;
    if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
      throw new TypeError('PostgreSQL reporting clock is unavailable.');
    }
    return buildFactualInsights({
      requests: requests.map((request) => ({
        ...request,
        items: request.items.map((item) => ({ ...item, quantity: item.quantity.toString() })),
        supplierRequests: request.supplierRequests.map((supplierRequest) => ({
          id: supplierRequest.id,
          supplierId: supplierRequest.supplierId,
          supplierName: supplierRequest.supplier.businessName,
          latestQuote: supplierRequest.quotes[0] ? {
            ...supplierRequest.quotes[0],
            items: supplierRequest.quotes[0].items.map((item) => ({
              ...item,
              availableQuantity: item.availableQuantity?.toString() ?? null,
              unitRatePaise: item.unitRatePaise?.toString() ?? null,
            })),
          } : null,
        })),
      })),
      awardedRequestCount: awards._count._all,
      totalAwardedPaise: awards._sum.totalPaise?.toString() ?? '0',
      capped,
      generatedAt,
    });
  }, client);
}

type HistoryCursor = { snapshot: Date; createdAt: Date; id: string };

export function encodeHistoryCursor(cursor: HistoryCursor) {
  return Buffer.from(JSON.stringify({
    v: 1,
    snapshot: cursor.snapshot.toISOString(),
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  }), 'utf8').toString('base64url');
}

export function decodeHistoryCursor(value: string): HistoryCursor {
  if (!value || Buffer.byteLength(value, 'utf8') > REPORTING_LIMITS.cursorBytes) {
    throw new ReportingValidationError({ cursor: ['History cursor is invalid.'] });
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    const snapshot = new Date(String(parsed.snapshot ?? ''));
    const createdAt = new Date(String(parsed.createdAt ?? ''));
    if (
      parsed.v !== 1 || !validId(parsed.id) ||
      Number.isNaN(snapshot.getTime()) || Number.isNaN(createdAt.getTime()) ||
      createdAt.getTime() > snapshot.getTime()
    ) throw new Error('invalid');
    return { snapshot, createdAt, id: String(parsed.id) };
  } catch {
    throw new ReportingValidationError({ cursor: ['History cursor is invalid.'] });
  }
}

export async function listProcurementHistory(
  input: { actor: ReportingActor; cursor?: string; limit?: number },
  client: ReportingClient = prisma,
) {
  const actor = validateActor(input.actor);
  const limit = input.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > REPORTING_LIMITS.historyPage) {
    throw new ReportingValidationError({ limit: [`Limit must be between 1 and ${REPORTING_LIMITS.historyPage}.`] });
  }
  const decoded = input.cursor ? decodeHistoryCursor(input.cursor) : null;
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActor(transaction, actor);
    const clock = decoded ? null : await transaction.$queryRaw<Array<{ now: Date }>>`SELECT transaction_timestamp() AS "now"`;
    const snapshot = decoded?.snapshot ?? clock?.[0]?.now;
    if (!(snapshot instanceof Date) || Number.isNaN(snapshot.getTime())) throw new TypeError('PostgreSQL history clock is unavailable.');
    const [requests, quoteRevisions, auditRecords] = await Promise.all([
      transaction.procurementRequest.findMany({
      where: {
        tenantId: actor.tenantId,
        openedAt: { not: null },
        createdAt: { lte: snapshot },
        ...(decoded ? { OR: [
          { createdAt: { lt: decoded.createdAt } },
          { createdAt: decoded.createdAt, id: { lt: decoded.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, title: true, status: true, version: true,
        deliveryDate: true, quoteDeadline: true, createdAt: true, openedAt: true, awardedAt: true,
        _count: { select: { items: true, supplierRequests: true } },
        supplierRequests: {
          select: { id: true, _count: { select: { quotes: true } } },
        },
        award: { select: { id: true, totalPaise: true, createdAt: true, supplierSnapshots: true } },
      },
      }),
      decoded ? Promise.resolve([]) : transaction.supplierQuote.findMany({
        where: { tenantId: actor.tenantId, submittedAt: { lte: snapshot } },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: REPORTING_LIMITS.recentHistoryRecords,
        select: {
          id: true,
          revision: true,
          submittedAt: true,
          totalPaise: true,
          supplierRequest: {
            select: {
              request: { select: { id: true, title: true } },
              supplier: { select: { businessName: true } },
            },
          },
        },
      }),
      decoded ? Promise.resolve([]) : transaction.auditEvent.findMany({
        where: {
          tenantId: actor.tenantId,
          createdAt: { lte: snapshot },
          action: { in: Object.keys(historyActivityLabels) },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: REPORTING_LIMITS.recentHistoryRecords,
        select: {
          id: true,
          action: true,
          entityType: true,
          metadata: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      }),
    ]);
    const hasMore = requests.length > limit;
    if (hasMore) requests.pop();
    const last = requests.at(-1);
    return {
      requests: requests.map(({ supplierRequests, award, ...request }) => ({
        ...request,
        respondingSupplierCount: supplierRequests.filter(({ _count }) => _count.quotes > 0).length,
        quoteRevisionCount: supplierRequests.reduce((sum, supplierRequest) => sum + supplierRequest._count.quotes, 0),
        award: award ? {
          id: award.id,
          totalPaise: award.totalPaise.toString(),
          createdAt: award.createdAt,
          supplierCount: Array.isArray(award.supplierSnapshots)
            ? award.supplierSnapshots.length
            : 0,
        } : null,
      })),
      nextCursor: hasMore && last ? encodeHistoryCursor({ snapshot, createdAt: last.createdAt, id: last.id }) : null,
      recentQuoteRevisions: quoteRevisions.map((quote) => ({
        id: quote.id,
        requestId: quote.supplierRequest.request.id,
        requestTitle: quote.supplierRequest.request.title,
        supplierName: quote.supplierRequest.supplier.businessName,
        revision: quote.revision,
        submittedAt: quote.submittedAt.toISOString(),
        totalPaise: quote.totalPaise.toString(),
      })),
      recentActivity: buildHistoryActivity(auditRecords),
    };
  }, client);
}
