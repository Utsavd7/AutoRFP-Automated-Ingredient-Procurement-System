import type { Prisma } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import {
  AwardDocumentStorageCorruptionError,
  validateAwardDocuments,
} from '@/lib/awards/award-document';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  compareLatestQuotes,
  type ComparisonQuote,
  type ComparisonRequest,
} from '@/lib/comparison/compare-quotes';
import { withTenant } from '@/lib/db/tenant-transaction';
import { safeCsvFilename, safeExportFilename } from '@/lib/exports/csv';
import {
  ExportTooLargeError,
  MAX_EXPORT_BYTES,
} from '@/lib/exports/export-limit';
import {
  accountingCsv,
  awardCsv,
  quoteComparisonCsv,
  requestCsv,
  type AwardExport,
  type RequestExport,
} from '@/lib/exports/procurement-csv';
import type { PurchaseOrderData } from '@/lib/exports/purchase-order';
import {
  RequestDocumentValidationError,
  validateRequestDocuments,
} from '@/lib/procurement/request-document';
import { prisma } from '@/lib/prisma';
import { eligibleQuoteRequestItems } from '@/lib/quotes/public-quote-service';
import {
  latestQuoteRevision,
  PublicQuoteStorageCorruptionError,
  validateQuoteRevisionsDocument,
} from '@/lib/quotes/quote-revisions';
import { digestOpaqueToken } from '@/lib/security/tokens';

export {
  ExportTimeoutError,
  ExportTooLargeError,
  MAX_EXPORT_BYTES,
} from '@/lib/exports/export-limit';

export const QR_BODY_BYTES = 8 * 1_024;

export type RequestExportKind = 'request' | 'quotes' | 'award' | 'accounting';

export type ExportOutput = {
  bytes: Uint8Array;
  filename: string;
  mediaType: 'text/csv; charset=utf-8' | 'image/png' | 'application/pdf';
};

export class ExportNotFoundError extends Error {
  readonly code = 'EXPORT_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('The requested record is unavailable.');
    this.name = 'ExportNotFoundError';
  }
}

export class ExportConflictError extends Error {
  readonly code = 'EXPORT_CONFLICT';
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ExportConflictError';
  }
}

export class ExportValidationError extends Error {
  readonly code = 'INVALID_EXPORT';
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = 'ExportValidationError';
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validateActor(actor: { tenantId: string; userId: string }) {
  if (!validId(actor?.tenantId) || !validId(actor?.userId)) {
    throw new ExportNotFoundError();
  }
  return actor;
}

function validateRecordId(value: unknown) {
  if (!validId(value)) throw new ExportNotFoundError();
  return value;
}

function ensureKind(kind: unknown): RequestExportKind {
  if (
    kind === 'request' ||
    kind === 'quotes' ||
    kind === 'award' ||
    kind === 'accounting'
  ) {
    return kind;
  }
  throw new ExportValidationError('Choose request, quotes, award, or accounting.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function dateOnly(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ExportConflictError('The stored export data could not be verified.');
  }
  return value.toISOString().slice(0, 10);
}

function timestamp(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ExportConflictError('The stored export data could not be verified.');
  }
  return value.toISOString();
}

function requestDelivery(value: unknown): RequestExport['deliveryDetails'] {
  if (!isRecord(value)) {
    throw new ExportConflictError('The request delivery details could not be verified.');
  }
  const required = ['addressLine', 'city', 'state', 'pin'] as const;
  if (required.some((field) => typeof value[field] !== 'string')) {
    throw new ExportConflictError('The request delivery details could not be verified.');
  }
  if (value.instructions !== undefined && typeof value.instructions !== 'string') {
    throw new ExportConflictError('The request delivery details could not be verified.');
  }
  return {
    addressLine: value.addressLine as string,
    city: value.city as string,
    state: value.state as string,
    pin: value.pin as string,
    instructions: (value.instructions ?? null) as string | null,
  };
}

function storedRequestDocuments(items: unknown, sourcing: unknown) {
  try {
    return validateRequestDocuments(items, sourcing);
  } catch (error) {
    if (error instanceof RequestDocumentValidationError) {
      throw new ExportConflictError('The request document could not be verified.');
    }
    throw error;
  }
}

function encodeCsv(csv: string) {
  const bytes = new TextEncoder().encode(csv);
  if (bytes.byteLength > MAX_EXPORT_BYTES) throw new ExportTooLargeError();
  return bytes;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const PDF_SIGNATURE = [37, 80, 68, 70, 45] as const;

function boundedOutput(bytes: Uint8Array, kind: 'PNG' | 'PDF') {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
    throw new TypeError('The export renderer returned invalid output.');
  }
  if (bytes.byteLength > MAX_EXPORT_BYTES) throw new ExportTooLargeError();
  const signature = kind === 'PNG' ? PNG_SIGNATURE : PDF_SIGNATURE;
  if (
    bytes.byteLength < signature.length ||
    signature.some((value, index) => bytes[index] !== value)
  ) {
    throw new TypeError(`The export renderer did not return valid ${kind} data.`);
  }
  return bytes;
}

export function parseSupplierShareUrl(rawUrl: unknown, expectedOrigin: string) {
  if (typeof rawUrl !== 'string' || rawUrl.length < 1 || rawUrl.length > 4_096) {
    throw new ExportNotFoundError();
  }
  let url: URL;
  let origin: URL;
  try {
    url = new URL(rawUrl);
    origin = new URL(expectedOrigin);
  } catch {
    throw new ExportNotFoundError();
  }
  const expected = origin.origin;
  if (
    expectedOrigin !== expected ||
    url.origin !== expected ||
    url.username ||
    url.password ||
    url.pathname !== '/quote' ||
    url.search ||
    !url.hash.startsWith('#')
  ) {
    throw new ExportNotFoundError();
  }
  const hash = new URLSearchParams(url.hash.slice(1));
  const tokens = hash.getAll('token');
  if (tokens.length !== 1 || [...hash.keys()].some((key) => key !== 'token')) {
    throw new ExportNotFoundError();
  }
  try {
    const tokenDigest = digestOpaqueToken('supplier-request', tokens[0]!);
    const canonical = new URL('/quote', `${expected}/`);
    canonical.hash = new URLSearchParams({ token: tokens[0]! }).toString();
    if (canonical.toString() !== url.toString()) throw new ExportNotFoundError();
    return { url: canonical.toString(), tokenDigest };
  } catch {
    throw new ExportNotFoundError();
  }
}

type ExportDependencies = {
  transact: <T>(
    tenantId: string,
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  renderQr: (url: string) => Promise<Uint8Array>;
  renderPdf: (data: PurchaseOrderData) => Promise<Uint8Array>;
};

const defaultDependencies: ExportDependencies = {
  transact: (tenantId, callback) => withTenant(tenantId, callback, prisma),
  renderQr: async (url) => {
    const { renderSupplierLinkQr } = await import('@/lib/exports/qr');
    return renderSupplierLinkQr(url);
  },
  renderPdf: async (data) => {
    const { renderPurchaseOrderPdf } = await import('@/lib/exports/purchase-order');
    return renderPurchaseOrderPdf(data);
  },
};

async function requireActiveUser(
  transaction: Prisma.TransactionClient,
  actor: { tenantId: string; userId: string },
) {
  const user = await transaction.user.findFirst({
    where: {
      tenantId: actor.tenantId,
      id: actor.userId,
      isActive: true,
      accountState: 'ACTIVE',
      tenant: { isActive: true },
    },
    select: { id: true },
  });
  if (!user) throw new AuthorizationError();
  return user;
}

async function auditOutput(
  dependencies: ExportDependencies,
  input: {
    actor: { tenantId: string; userId: string };
    requestId: string;
    kind: string;
    format: 'csv' | 'png' | 'pdf';
    byteCount: number;
  },
) {
  await dependencies.transact(input.actor.tenantId, async (transaction) => {
    await requireActiveUser(transaction, input.actor);
    await writeAuditEvent(transaction, {
      tenantId: input.actor.tenantId,
      actorUserId: input.actor.userId,
      action: 'audit.export',
      entityId: input.requestId,
      metadata: {
        kind: input.kind,
        format: input.format,
        byteCount: input.byteCount,
      },
    });
  });
}

const currentRequestSelect = {
  id: true,
  title: true,
  status: true,
  deliveryDate: true,
  quoteDeadline: true,
  deliveryDetails: true,
  commercialTerms: true,
  items: true,
  sourcing: true,
} as const;

const awardSelect = {
  id: true,
  requestId: true,
  rationale: true,
  allocationLines: true,
  supplierSnapshots: true,
  deliverySnapshot: true,
  totalPaise: true,
  createdAt: true,
} as const;

function requestForExport(request: {
  id: string;
  title: string;
  status: string;
  deliveryDate: Date;
  quoteDeadline: Date;
  deliveryDetails: Prisma.JsonValue;
  commercialTerms: string | null;
  items: Prisma.JsonValue;
  sourcing: Prisma.JsonValue;
}) {
  const documents = storedRequestDocuments(request.items, request.sourcing);
  const value: RequestExport = {
    id: request.id,
    title: request.title,
    status: request.status,
    deliveryDate: dateOnly(request.deliveryDate),
    quoteDeadline: timestamp(request.quoteDeadline),
    deliveryDetails: requestDelivery(request.deliveryDetails),
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
  return { value, documents };
}

function verifiedAward(row: {
  allocationLines: unknown;
  supplierSnapshots: unknown;
  deliverySnapshot: unknown;
  totalPaise: unknown;
}) {
  try {
    return validateAwardDocuments(row);
  } catch (error) {
    if (error instanceof AwardDocumentStorageCorruptionError) {
      throw new ExportConflictError('The committed award data could not be verified.');
    }
    throw error;
  }
}

function awardForExport(row: {
  id: string;
  requestId: string;
  rationale: string | null;
  allocationLines: unknown;
  supplierSnapshots: unknown;
  deliverySnapshot: unknown;
  totalPaise: unknown;
  createdAt: Date;
}): AwardExport {
  const documents = verifiedAward(row);
  const supplierByRevision = new Map(documents.supplierSnapshots.suppliers.map(
    (supplier) => [
      `${supplier.supplierRequestId}\u0000${supplier.quoteRevision}`,
      supplier,
    ],
  ));
  return {
    id: row.id,
    requestId: row.requestId,
    requestTitle: documents.deliverySnapshot.requestTitle,
    rationale: row.rationale,
    totalPaise: documents.totalPaise,
    createdAt: timestamp(row.createdAt),
    suppliers: documents.supplierSnapshots.suppliers.map((supplier) => ({
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
      gstin: supplier.gstin,
      freightPaise: supplier.freightPaise,
    })),
    lines: documents.allocationLines.lines.map((allocation) => {
      const supplier = supplierByRevision.get(
        `${allocation.supplierRequestId}\u0000${allocation.quoteRevision}`,
      );
      const description = supplier?.lines.find(
        ({ requestItemId }) => requestItemId === allocation.requestItemId,
      );
      if (!supplier || !description) {
        throw new ExportConflictError('The committed award data could not be verified.');
      }
      return {
        requestItemId: allocation.requestItemId,
        itemKey: description.itemKey,
        itemName: description.itemName,
        requestedQuantity: description.requestedQuantity,
        requestedUnit: description.requestedUnit,
        requestedSpecification: description.requestedSpecification,
        supplierId: allocation.supplierId,
        quantity: allocation.quantity,
        unit: allocation.unit,
        unitRatePaise: allocation.unitRatePaise,
        gstBasisPoints: allocation.gstBasisPoints,
        taxInclusive: description.taxInclusive,
        suppliedBrand: description.suppliedBrand,
        suppliedPackSize: description.suppliedPackSize,
        suppliedQualityGrade: description.suppliedQualityGrade,
        substitution: description.substitution,
        subtotalPaise: allocation.subtotalPaise,
        gstPaise: allocation.gstPaise,
        totalPaise: allocation.totalPaise,
      };
    }),
  };
}

function purchaseOrderData(
  row: Parameters<typeof awardForExport>[0],
  supplierId: string,
): PurchaseOrderData {
  const documents = verifiedAward(row);
  const supplier = documents.supplierSnapshots.suppliers.find(
    (candidate) => candidate.supplierId === supplierId,
  );
  if (!supplier) throw new ExportNotFoundError();
  const descriptionByItem = new Map(
    supplier.lines.map((line) => [line.requestItemId, line]),
  );
  const allocations = documents.allocationLines.lines.filter(
    (line) => line.supplierId === supplierId,
  );
  if (allocations.length < 1) throw new ExportNotFoundError();
  let subtotalPaise = BigInt(0);
  let gstPaise = BigInt(0);
  let lineTotalPaise = BigInt(0);
  const lines = allocations.map((line) => {
    const description = descriptionByItem.get(line.requestItemId);
    if (!description) {
      throw new ExportConflictError('The committed award data could not be verified.');
    }
    subtotalPaise += BigInt(line.subtotalPaise);
    gstPaise += BigInt(line.gstPaise);
    lineTotalPaise += BigInt(line.totalPaise);
    return {
      requestItemId: line.requestItemId,
      itemName: description.itemName,
      requestedDescription: description.requestedSpecification.description ?? null,
      requestedBrand: description.requestedSpecification.preferredBrand ?? null,
      suppliedBrand: description.suppliedBrand,
      requestedPackSize: description.requestedSpecification.packSize ?? null,
      suppliedPackSize: description.suppliedPackSize,
      requestedQualityGrade:
        description.requestedSpecification.qualityGrade ?? null,
      suppliedQualityGrade: description.suppliedQualityGrade,
      substitution: description.substitution,
      quantity: line.quantity,
      unit: line.unit,
      unitRatePaise: line.unitRatePaise,
      gstBasisPoints: line.gstBasisPoints,
      taxInclusive: description.taxInclusive,
      subtotalPaise: line.subtotalPaise,
      gstPaise: line.gstPaise,
      totalPaise: line.totalPaise,
    };
  });
  const delivery = documents.deliverySnapshot;
  return {
    awardId: row.id,
    requestId: row.requestId,
    requestTitle: delivery.requestTitle,
    awardedAt: timestamp(row.createdAt),
    buyer: delivery.buyer,
    delivery: {
      requestedDeliveryDate: delivery.requestedDeliveryDate,
      addressLine: delivery.deliveryDetails.addressLine,
      city: delivery.deliveryDetails.city,
      state: delivery.deliveryDetails.state,
      pin: delivery.deliveryDetails.pin,
      instructions: delivery.deliveryDetails.instructions,
      commercialTerms: delivery.commercialTerms,
    },
    supplier: {
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
      gstin: supplier.gstin,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      addressLine: supplier.addressLine,
      city: supplier.city,
      state: supplier.state,
      pin: supplier.pin,
      freightPaise: supplier.freightPaise,
      minimumOrder: supplier.minimumOrder,
      commercialTerms: supplier.commercialTerms,
      notes: supplier.notes,
      deliveryDate: supplier.deliveryDate,
      validUntil: supplier.validUntil,
    },
    lines,
    subtotalPaise: subtotalPaise.toString(),
    gstPaise: gstPaise.toString(),
    freightPaise: supplier.freightPaise,
    totalPaise: (lineTotalPaise + BigInt(supplier.freightPaise)).toString(),
  };
}

type PreparedCsv =
  | { kind: 'request'; title: string; request: RequestExport }
  | {
      kind: 'quotes';
      title: string;
      comparison: Parameters<typeof quoteComparisonCsv>[0];
    }
  | { kind: 'award' | 'accounting'; title: string; award: AwardExport };

function renderPreparedCsv(prepared: PreparedCsv) {
  switch (prepared.kind) {
    case 'request':
      return requestCsv(prepared.request);
    case 'quotes':
      return quoteComparisonCsv(prepared.comparison);
    case 'award':
      return awardCsv(prepared.award);
    case 'accounting':
      return accountingCsv(prepared.award);
  }
}

export function createExportOperations(
  dependencies: ExportDependencies = defaultDependencies,
) {
  return {
    dependencies,

    async requestCsv(input: {
      actor: { tenantId: string; userId: string };
      requestId: string;
      kind: RequestExportKind;
    }): Promise<ExportOutput> {
      const actor = validateActor(input.actor);
      const requestId = validateRecordId(input.requestId);
      const kind = ensureKind(input.kind);

      const prepared = await dependencies.transact(
        actor.tenantId,
        async (transaction) => {
          await requireActiveUser(transaction, actor);
          if (kind === 'award' || kind === 'accounting') {
            const row = await transaction.award.findFirst({
              where: { tenantId: actor.tenantId, requestId },
              select: awardSelect,
            });
            if (!row) {
              throw new ExportConflictError(
                'Record an award before exporting this file.',
              );
            }
            const award = awardForExport(row);
            return {
              kind,
              award,
              title: award.requestTitle,
            } satisfies PreparedCsv;
          }

          if (kind === 'request') {
            const row = await transaction.procurementRequest.findFirst({
              where: { tenantId: actor.tenantId, id: requestId },
              select: currentRequestSelect,
            });
            if (!row) throw new ExportNotFoundError();
            const request = requestForExport(row);
            return {
              kind,
              request: request.value,
              title: request.value.title,
            } satisfies PreparedCsv;
          }

          const row = await transaction.procurementRequest.findFirst({
            where: { tenantId: actor.tenantId, id: requestId },
            select: {
              ...currentRequestSelect,
              supplierRequests: {
                orderBy: { id: 'asc' },
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
          if (!row) throw new ExportNotFoundError();
          const request = requestForExport(row);
          const comparisonRequest: ComparisonRequest = {
            id: row.id,
            title: row.title,
            deliveryDate: dateOnly(row.deliveryDate),
            quoteDeadline: timestamp(row.quoteDeadline),
            commercialTerms: row.commercialTerms,
            items: request.value.items,
          };
          let quotes: ComparisonQuote[];
          try {
            quotes = row.supplierRequests.flatMap<ComparisonQuote>((supplierRequest) => {
              const eligibleItems = eligibleQuoteRequestItems({
                requestId: row.id,
                items: request.documents.items,
                sourcing: request.documents.sourcing,
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
                ? [{
                    supplierRequestId: supplierRequest.id,
                    supplierName: supplierRequest.supplier.businessName,
                    supplierActive: supplierRequest.supplier.isActive,
                    eligibleRequestItemIds: eligibleItems.map(({ id }) => id),
                    ...latest,
                  }]
                : [];
            });
          } catch (error) {
            if (error instanceof PublicQuoteStorageCorruptionError) {
              throw new ExportConflictError(
                'The supplier quote documents could not be verified.',
              );
            }
            throw error;
          }
          const comparison = compareLatestQuotes(comparisonRequest, quotes);
          return {
            kind,
            comparison: {
              request: {
                ...request.value,
                itemCount: request.value.items.length,
              },
              quotes: comparison.quotes,
            },
            title: request.value.title,
          } satisfies PreparedCsv;
        },
      );

      const bytes = encodeCsv(renderPreparedCsv(prepared));
      return {
        bytes,
        filename: safeCsvFilename(prepared.title, kind),
        mediaType: 'text/csv; charset=utf-8',
      };
    },

    async qr(input: {
      actor: { tenantId: string; userId: string };
      requestId: string;
      expectedOrigin: string;
      url: unknown;
    }): Promise<ExportOutput> {
      const actor = validateActor(input.actor);
      const requestId = validateRecordId(input.requestId);
      const link = parseSupplierShareUrl(input.url, input.expectedOrigin);
      const grantWhere = {
        tenantId: actor.tenantId,
        requestId,
        tokenDigest: link.tokenDigest,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        request: { status: 'OPEN' as const },
        supplier: { isActive: true },
      };
      const prepared = await dependencies.transact(
        actor.tenantId,
        async (transaction) => {
          await requireActiveUser(transaction, actor);
          const grant = await transaction.supplierRequest.findFirst({
            where: grantWhere,
            select: {
              id: true,
              supplier: { select: { businessName: true } },
              request: { select: { title: true } },
            },
          });
          if (!grant) throw new ExportNotFoundError();
          return {
            filename: safeExportFilename(
              grant.request.title,
              `quote-link-${grant.supplier.businessName}`,
              'png',
            ),
          };
        },
      );
      const bytes = boundedOutput(await dependencies.renderQr(link.url), 'PNG');
      await auditOutput(dependencies, {
        actor,
        requestId,
        kind: 'supplier-link',
        format: 'png',
        byteCount: bytes.byteLength,
      });
      return { bytes, filename: prepared.filename, mediaType: 'image/png' };
    },

    async purchaseOrder(input: {
      actor: { tenantId: string; userId: string };
      awardId: string;
      supplierId: string;
    }): Promise<ExportOutput> {
      const actor = validateActor(input.actor);
      const awardId = validateRecordId(input.awardId);
      const supplierId = validateRecordId(input.supplierId);
      const prepared = await dependencies.transact(
        actor.tenantId,
        async (transaction) => {
          await requireActiveUser(transaction, actor);
          const row = await transaction.award.findFirst({
            where: { tenantId: actor.tenantId, id: awardId },
            select: awardSelect,
          });
          if (!row) throw new ExportNotFoundError();
          const data = purchaseOrderData(row, supplierId);
          return {
            data,
            requestId: row.requestId,
            requestTitle: data.requestTitle,
            supplierName: data.supplier.supplierName,
          };
        },
      );
      const bytes = boundedOutput(
        await dependencies.renderPdf(prepared.data),
        'PDF',
      );
      return {
        bytes,
        filename: safeExportFilename(
          prepared.requestTitle,
          `po-${prepared.supplierName}`,
          'pdf',
        ),
        mediaType: 'application/pdf',
      };
    },
  };
}

export const exportOperations = createExportOperations();
