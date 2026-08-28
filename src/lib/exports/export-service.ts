import type { Prisma } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { AuthorizationError } from '@/lib/auth/guards';
import { compareLatestQuotes } from '@/lib/comparison/compare-quotes';
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
} from '@/lib/exports/procurement-csv';
import type { PurchaseOrderData } from '@/lib/exports/purchase-order';
import { prisma } from '@/lib/prisma';
import { digestOpaqueToken } from '@/lib/security/tokens';

export {
  ExportTimeoutError,
  ExportTooLargeError,
  MAX_EXPORT_BYTES,
} from '@/lib/exports/export-limit';
export const QR_BODY_BYTES = 8 * 1_024;
const MAX_REQUEST_ITEMS = 1_000;
const MAX_AWARD_LINES = 2_000;

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
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, maximumBytes = 2_000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExportConflictError('The committed award snapshot is incomplete.');
  }
  const text = value.trim();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new ExportConflictError('The committed award snapshot is outside supported limits.');
  }
  return text;
}

function optionalString(value: unknown, maximumBytes = 2_000) {
  if (value === null || value === undefined || value === '') return null;
  return requiredString(value, maximumBytes);
}

function moneyString(value: unknown) {
  const text = requiredString(value, 24);
  if (!/^\d+$/.test(text) || BigInt(text) > BigInt('9223372036854775807')) {
    throw new ExportConflictError('The committed award contains invalid money values.');
  }
  return text;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function deliveryDetails(value: unknown) {
  if (!isRecord(value)) {
    throw new ExportConflictError('The request delivery details are incomplete.');
  }
  return {
    addressLine: requiredString(value.addressLine, 400),
    city: requiredString(value.city, 120),
    state: requiredString(value.state, 120),
    pin: requiredString(value.pin, 6),
    instructions: optionalString(value.instructions, 1_000) ?? undefined,
  };
}

type SupplierSnapshot = {
  supplierId: string;
  supplierName: string;
  contactName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  gstin: string | null;
  quoteId: string;
  supplierRequestId: string;
  revision: number;
  freightPaise: string;
  deliveryDate: string;
  validUntil: string;
  commercialTerms: string | null;
  notes: string | null;
  submittedAt: string;
};

function supplierSnapshots(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new ExportConflictError('The committed award supplier snapshot is incomplete.');
  }
  const ids = new Set<string>();
  return value.map<SupplierSnapshot>((raw) => {
    if (!isRecord(raw)) {
      throw new ExportConflictError('The committed award supplier snapshot is incomplete.');
    }
    const snapshot: SupplierSnapshot = {
      supplierId: requiredString(raw.supplierId, 200),
      supplierName: requiredString(raw.supplierName, 200),
      contactName: optionalString(raw.contactName, 200),
      phone: optionalString(raw.phone, 40),
      whatsappNumber: optionalString(raw.whatsappNumber, 40),
      email: optionalString(raw.email, 320),
      addressLine: optionalString(raw.addressLine, 400),
      city: optionalString(raw.city, 120),
      state: optionalString(raw.state, 120),
      pin: optionalString(raw.pin, 12),
      gstin: optionalString(raw.gstin, 20),
      quoteId: requiredString(raw.quoteId, 200),
      supplierRequestId: requiredString(raw.supplierRequestId, 200),
      revision: Number(raw.revision),
      freightPaise: moneyString(raw.freightPaise),
      deliveryDate: requiredString(raw.deliveryDate, 10),
      validUntil: requiredString(raw.validUntil, 10),
      commercialTerms: optionalString(raw.commercialTerms, 2_000),
      notes: optionalString(raw.notes, 2_000),
      submittedAt: requiredString(raw.submittedAt, 40),
    };
    if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
      throw new ExportConflictError('The committed award supplier revision is invalid.');
    }
    if (ids.has(snapshot.supplierId)) {
      throw new ExportConflictError('The committed award supplier snapshot is ambiguous.');
    }
    ids.add(snapshot.supplierId);
    return snapshot;
  });
}

function deliverySnapshot(value: unknown) {
  if (!isRecord(value)) {
    throw new ExportConflictError('The committed award delivery snapshot is incomplete.');
  }
  return {
    requestTitle: requiredString(value.requestTitle, 160),
    requestedDeliveryDate: requiredString(value.requestedDeliveryDate, 10),
    deliveryDetails: deliveryDetails(value.deliveryDetails),
    buyer: buyerSnapshot(value.buyer),
  };
}

function buyerSnapshot(value: unknown): PurchaseOrderData['buyer'] {
  if (!isRecord(value)) {
    throw new ExportConflictError('The committed award buyer snapshot is incomplete.');
  }
  return {
    name: requiredString(value.name, 160),
    gstin: optionalString(value.gstin, 20),
    addressLine: optionalString(value.addressLine, 400),
    city: optionalString(value.city, 120),
    state: optionalString(value.state, 120),
    pin: optionalString(value.pin, 12),
    phone: optionalString(value.phone, 40),
  };
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

function ensureKind(kind: unknown): RequestExportKind {
  if (kind === 'request' || kind === 'quotes' || kind === 'award' || kind === 'accounting') {
    return kind;
  }
  throw new ExportValidationError('Choose request, quotes, award, or accounting.');
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
      tenant: { isActive: true },
    },
    select: { id: true },
  });
  if (!user) throw new AuthorizationError();
  return user;
}

function exportAudit(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    userId: string;
    requestId: string;
    kind: string;
    format: 'csv' | 'png' | 'pdf';
    byteCount: number;
  },
) {
  return writeAuditEvent(transaction, {
    tenantId: input.tenantId,
    actorUserId: input.userId,
    action: 'audit.export',
    entityId: input.requestId,
    metadata: {
      kind: input.kind,
      format: input.format,
      byteCount: input.byteCount,
    },
  });
}

export function createExportOperations(dependencies: ExportDependencies = defaultDependencies) {
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
      return dependencies.transact(actor.tenantId, async (transaction) => {
        await requireActiveUser(transaction, actor);
        const request = await transaction.procurementRequest.findFirst({
          where: { tenantId: actor.tenantId, id: requestId },
          select: {
            id: true,
            title: true,
            status: true,
            deliveryDate: true,
            quoteDeadline: true,
            deliveryDetails: true,
            commercialTerms: true,
            items: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: { id: true, name: true, quantity: true, unit: true },
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
                  orderBy: [{ requestItemId: 'asc' }, { supplierId: 'asc' }],
                  select: {
                    requestItemId: true,
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
          },
        });
        if (!request || request.items.length < 1 || request.items.length > MAX_REQUEST_ITEMS) {
          throw new ExportNotFoundError();
        }

        const requestForCsv = {
          id: request.id,
          title: request.title,
          status: request.status,
          deliveryDate: dateOnly(request.deliveryDate),
          quoteDeadline: request.quoteDeadline.toISOString(),
          deliveryDetails: deliveryDetails(request.deliveryDetails),
          commercialTerms: request.commercialTerms,
          items: request.items.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity.toString(),
            unit: item.unit,
          })),
        };

        let csv: string;
        let filenameTitle = request.title;
        if (kind === 'request') {
          csv = requestCsv(requestForCsv);
        } else if (kind === 'quotes') {
          const comparison = compareLatestQuotes(
            {
              id: request.id,
              title: request.title,
              deliveryDate: request.deliveryDate,
              quoteDeadline: request.quoteDeadline,
              commercialTerms: request.commercialTerms,
              items: requestForCsv.items,
            },
            request.supplierRequests.flatMap((supplierRequest) => {
              const quote = supplierRequest.quotes[0];
              return quote
                ? [{
                    ...quote,
                    supplierRequestId: supplierRequest.id,
                    supplierId: supplierRequest.supplierId,
                    supplierName: supplierRequest.supplier.businessName,
                    supplierActive: supplierRequest.supplier.isActive,
                    items: quote.items.map((item) => ({
                      ...item,
                      availableQuantity: item.availableQuantity?.toString() ?? null,
                    })),
                  }]
                : [];
            }),
          );
          csv = quoteComparisonCsv({
            request: { ...requestForCsv, itemCount: request.items.length },
            quotes: comparison.quotes,
          });
        } else {
          if (!request.award) {
            throw new ExportConflictError('Record an award before exporting this file.');
          }
          if (request.award.lines.length < 1 || request.award.lines.length > MAX_AWARD_LINES) {
            throw new ExportConflictError('The committed award has an invalid line count.');
          }
          const snapshots = supplierSnapshots(request.award.supplierSnapshots);
          const delivery = deliverySnapshot(request.award.deliverySnapshot);
          filenameTitle = delivery.requestTitle;
          const award: AwardExport = {
            id: request.award.id,
            requestId: request.award.requestId,
            requestTitle: delivery.requestTitle,
            rationale: request.award.rationale,
            totalPaise: request.award.totalPaise.toString(),
            createdAt: request.award.createdAt.toISOString(),
            suppliers: snapshots.map((snapshot) => ({
              supplierId: snapshot.supplierId,
              supplierName: snapshot.supplierName,
              gstin: snapshot.gstin,
              freightPaise: snapshot.freightPaise,
            })),
            lines: request.award.lines.map((line) => ({
              requestItemId: line.requestItemId,
              itemName: line.requestItem.name,
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
          csv = kind === 'award' ? awardCsv(award) : accountingCsv(award);
        }

        const bytes = encodeCsv(csv);
        await exportAudit(transaction, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          requestId,
          kind,
          format: 'csv',
          byteCount: bytes.byteLength,
        });
        return {
          bytes,
          filename: safeCsvFilename(filenameTitle, kind),
          mediaType: 'text/csv; charset=utf-8',
        };
      });
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
      const prepared = await dependencies.transact(actor.tenantId, async (transaction) => {
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
      });
      const bytes = boundedOutput(await dependencies.renderQr(link.url), 'PNG');
      await dependencies.transact(actor.tenantId, async (transaction) => {
        await requireActiveUser(transaction, actor);
        const grant = await transaction.supplierRequest.findFirst({
          where: { ...grantWhere, expiresAt: { gt: new Date() } },
          select: { id: true },
        });
        if (!grant) throw new ExportNotFoundError();
        await exportAudit(transaction, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          requestId,
          kind: 'supplier-link',
          format: 'png',
          byteCount: bytes.byteLength,
        });
      });
      return {
        bytes,
        filename: prepared.filename,
        mediaType: 'image/png',
      };
    },

    async purchaseOrder(input: {
      actor: { tenantId: string; userId: string };
      awardId: string;
      supplierId: string;
    }): Promise<ExportOutput> {
      const actor = validateActor(input.actor);
      const awardId = validateRecordId(input.awardId);
      const supplierId = validateRecordId(input.supplierId);
      const prepared = await dependencies.transact(actor.tenantId, async (transaction) => {
        await requireActiveUser(transaction, actor);
        const award = await transaction.award.findFirst({
          where: { tenantId: actor.tenantId, id: awardId },
          select: {
            id: true,
            requestId: true,
            rationale: true,
            supplierSnapshots: true,
            deliverySnapshot: true,
            totalPaise: true,
            createdAt: true,
            lines: {
              where: { supplierId },
              orderBy: [{ requestItemId: 'asc' }, { supplierQuoteItemId: 'asc' }],
              select: {
                requestItemId: true,
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
        });
        if (!award) throw new ExportNotFoundError();
        if (award.lines.length < 1 || award.lines.length > MAX_AWARD_LINES) {
          throw new ExportNotFoundError();
        }
        const snapshot = supplierSnapshots(award.supplierSnapshots).find(
          (candidate) => candidate.supplierId === supplierId,
        );
        if (!snapshot) throw new ExportNotFoundError();
        const delivery = deliverySnapshot(award.deliverySnapshot);
        const subtotalPaise = award.lines.reduce(
          (sum, line) => sum + line.subtotalPaise,
          BigInt(0),
        );
        const gstPaise = award.lines.reduce(
          (sum, line) => sum + line.gstPaise,
          BigInt(0),
        );
        const lineTotalPaise = award.lines.reduce(
          (sum, line) => sum + line.totalPaise,
          BigInt(0),
        );
        const totalPaise = lineTotalPaise + BigInt(snapshot.freightPaise);
        const data: PurchaseOrderData = {
          awardId: award.id,
          requestId: award.requestId,
          requestTitle: delivery.requestTitle,
          awardedAt: award.createdAt.toISOString(),
          rationale: award.rationale,
          buyer: delivery.buyer,
          delivery: {
            requestedDeliveryDate: delivery.requestedDeliveryDate,
            addressLine: delivery.deliveryDetails.addressLine,
            city: delivery.deliveryDetails.city,
            state: delivery.deliveryDetails.state,
            pin: delivery.deliveryDetails.pin,
            instructions: delivery.deliveryDetails.instructions ?? null,
          },
          supplier: {
            supplierId: snapshot.supplierId,
            supplierName: snapshot.supplierName,
            gstin: snapshot.gstin,
            contactName: snapshot.contactName,
            phone: snapshot.phone,
            email: snapshot.email,
            addressLine: snapshot.addressLine,
            city: snapshot.city,
            state: snapshot.state,
            pin: snapshot.pin,
            freightPaise: snapshot.freightPaise,
            commercialTerms: snapshot.commercialTerms,
            deliveryDate: snapshot.deliveryDate,
          },
          lines: award.lines.map((line) => ({
            requestItemId: line.requestItemId,
            itemName: line.requestItem.name,
            quantity: line.quantity.toString(),
            unit: line.unit,
            unitRatePaise: line.unitRatePaise.toString(),
            gstBasisPoints: line.gstBasisPoints,
            subtotalPaise: line.subtotalPaise.toString(),
            gstPaise: line.gstPaise.toString(),
            totalPaise: line.totalPaise.toString(),
          })),
          subtotalPaise: subtotalPaise.toString(),
          gstPaise: gstPaise.toString(),
          freightPaise: snapshot.freightPaise,
          totalPaise: totalPaise.toString(),
        };
        return {
          data,
          requestId: award.requestId,
          requestTitle: delivery.requestTitle,
          supplierName: snapshot.supplierName,
        };
      });
      const bytes = boundedOutput(
        await dependencies.renderPdf(prepared.data),
        'PDF',
      );
      await dependencies.transact(actor.tenantId, async (transaction) => {
        await requireActiveUser(transaction, actor);
        await exportAudit(transaction, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          requestId: prepared.requestId,
          kind: 'purchase-order',
          format: 'pdf',
          byteCount: bytes.byteLength,
        });
      });
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
