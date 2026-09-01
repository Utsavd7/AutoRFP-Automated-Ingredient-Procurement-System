import { Prisma, type PrismaClient } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import {
  type AwardAllocationLineV1,
  type AwardAllocationLinesV1,
  type AwardDeliverySnapshotV1,
  AwardDocumentStorageCorruptionError,
  type AwardSupplierSnapshotV1,
  type AwardSupplierSnapshotsV1,
  validateAwardDocuments,
} from '@/lib/awards/award-document';
import { AuthorizationError, requireOwner } from '@/lib/auth/guards';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import { calculateGst, multiplyPaise } from '@/lib/domain/money';
import { assertBoundedJson } from '@/lib/domain/postgres-json';
import {
  assertMaximum,
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  MAX_SIGNED_BIGINT,
  parseUnsignedFixed,
} from '@/lib/domain/validation';
import {
  type RequestItemsV1,
  RequestDocumentValidationError,
  type RequestSourcingV1,
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

export const AWARD_BODY_BYTES = 512 * 1_024;
export const AWARD_MAX_SELECTIONS = DOCUMENT_LIMITS.awardLines.lines;
export const AWARD_SUPPLIER_SNAPSHOTS_BYTES =
  DOCUMENT_LIMITS.awardSupplierSnapshots.jsonBytes;

type ValidationErrors = Record<string, string[]>;

export class AwardValidationError extends Error {
  readonly code = 'INVALID_AWARD';
  readonly status = 422;

  constructor(readonly errors: ValidationErrors) {
    super('The award contains invalid or unbounded fields.');
    this.name = 'AwardValidationError';
  }
}

export class AwardNotFoundError extends Error {
  readonly code = 'AWARD_REQUEST_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Procurement request not found.');
    this.name = 'AwardNotFoundError';
  }
}

export class AwardConflictError extends Error {
  readonly code = 'AWARD_CONFLICT';
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'AwardConflictError';
  }
}

export class AwardSnapshotTooLargeError extends Error {
  readonly code = 'AWARD_SNAPSHOT_TOO_LARGE';
  readonly status = 422;

  constructor() {
    super('The committed award documents exceed the supported size.');
    this.name = 'AwardSnapshotTooLargeError';
  }
}

export type ValidAwardSelection = {
  requestItemId: string;
  supplierRequestId: string;
  quoteRevision: number;
  quantity: string;
};

export type ValidAwardInput =
  | {
      mode: 'WHOLE';
      expectedRequestVersion: number;
      supplierRequestId: string;
      quoteRevision: number;
      rationale: string;
    }
  | {
      mode: 'SPLIT';
      expectedRequestVersion: number;
      selections: ValidAwardSelection[];
      rationale: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function addError(errors: ValidationErrors, path: string, message: string) {
  (errors[path] ??= []).push(message);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  errors: ValidationErrors,
  path = '',
) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      addError(
        errors,
        path ? `${path}.${String(key)}` : String(key),
        'This field is not allowed.',
      );
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      addError(
        errors,
        path ? `${path}.${key}` : key,
        'This field must be an enumerable data property.',
      );
    }
  }
}

function boundedText(
  value: unknown,
  path: string,
  maximumBytes: number,
  errors: ValidationErrors,
) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    addError(errors, path, 'This field is required.');
    return '';
  }
  if (new TextEncoder().encode(value).byteLength > maximumBytes) {
    addError(errors, path, `This field must not exceed ${maximumBytes} bytes.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    addError(errors, path, 'This field contains unsupported control characters.');
  }
  return value;
}

function boundedId(value: unknown, path: string, errors: ValidationErrors) {
  return boundedText(value, path, 200, errors);
}

function positiveInteger(
  value: unknown,
  path: string,
  errors: ValidationErrors,
  message: string,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 2_147_483_647
  ) {
    addError(errors, path, message);
    return 0;
  }
  return Number(value);
}

function canonicalInputQuantity(
  value: unknown,
  path: string,
  errors: ValidationErrors,
) {
  try {
    return formatScaledDecimal(parseUnsignedFixed(value as never, {
      label: 'Award quantity',
      scale: 3,
      maximumScaled: MAX_DECIMAL_18_3_SCALED,
      allowZero: false,
    }), 3);
  } catch {
    addError(
      errors,
      path,
      'Enter a positive quantity with up to three decimal places.',
    );
    return '';
  }
}

function parseSelections(value: unknown, errors: ValidationErrors) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > AWARD_MAX_SELECTIONS
  ) {
    addError(
      errors,
      'selections',
      `Select between 1 and ${AWARD_MAX_SELECTIONS} quote lines.`,
    );
    return [];
  }
  const seen = new Set<string>();
  return value.map<ValidAwardSelection>((raw, index) => {
    if (!isRecord(raw)) {
      addError(errors, `selections.${index}`, 'Provide an award selection.');
      return {
        requestItemId: '',
        supplierRequestId: '',
        quoteRevision: 0,
        quantity: '',
      };
    }
    rejectUnknownKeys(
      raw,
      ['requestItemId', 'supplierRequestId', 'quoteRevision', 'quantity'],
      errors,
      `selections.${index}`,
    );
    const requestItemId = boundedId(
      raw.requestItemId,
      `selections.${index}.requestItemId`,
      errors,
    );
    const supplierRequestId = boundedId(
      raw.supplierRequestId,
      `selections.${index}.supplierRequestId`,
      errors,
    );
    const quoteRevision = positiveInteger(
      raw.quoteRevision,
      `selections.${index}.quoteRevision`,
      errors,
      'Quote revision must be a positive integer.',
    );
    const quantity = canonicalInputQuantity(
      raw.quantity,
      `selections.${index}.quantity`,
      errors,
    );
    const identity =
      `${requestItemId}\u0000${supplierRequestId}\u0000${quoteRevision}`;
    if (seen.has(identity)) {
      addError(
        errors,
        `selections.${index}`,
        'Select each supplier revision item once.',
      );
    }
    seen.add(identity);
    return { requestItemId, supplierRequestId, quoteRevision, quantity };
  });
}

function throwIfInvalid(errors: ValidationErrors) {
  if (Reflect.ownKeys(errors).length > 0) throw new AwardValidationError(errors);
}

export function validateAwardInput(input: unknown): ValidAwardInput {
  const errors: ValidationErrors = Object.create(null) as ValidationErrors;
  if (!isRecord(input)) {
    throw new AwardValidationError({ award: ['Provide an award decision.'] });
  }
  const expectedRequestVersion = positiveInteger(
    input.expectedRequestVersion,
    'expectedRequestVersion',
    errors,
    'Expected version must be a positive integer.',
  );
  const rationale = boundedText(input.rationale, 'rationale', 500, errors);
  if (input.mode === 'WHOLE') {
    rejectUnknownKeys(input, [
      'mode',
      'expectedRequestVersion',
      'supplierRequestId',
      'quoteRevision',
      'rationale',
    ], errors);
    const supplierRequestId = boundedId(
      input.supplierRequestId,
      'supplierRequestId',
      errors,
    );
    const quoteRevision = positiveInteger(
      input.quoteRevision,
      'quoteRevision',
      errors,
      'Quote revision must be a positive integer.',
    );
    throwIfInvalid(errors);
    return {
      mode: 'WHOLE',
      expectedRequestVersion,
      supplierRequestId,
      quoteRevision,
      rationale,
    };
  }
  if (input.mode === 'SPLIT') {
    rejectUnknownKeys(
      input,
      ['mode', 'expectedRequestVersion', 'selections', 'rationale'],
      errors,
    );
    const selections = parseSelections(input.selections, errors);
    throwIfInvalid(errors);
    return {
      mode: 'SPLIT',
      expectedRequestVersion,
      selections,
      rationale,
    };
  }
  rejectUnknownKeys(input, ['mode', 'expectedRequestVersion', 'rationale'], errors);
  addError(errors, 'mode', 'Choose WHOLE or SPLIT.');
  throwIfInvalid(errors);
  throw new AwardValidationError(errors);
}

type AwardClient = TenantTransactionHost & Pick<PrismaClient, '$queryRaw'>;

type LockedTenant = {
  id: string;
  name: string;
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  phone: string;
  gstin: string | null;
  isActive: boolean;
};

type LockedRequest = {
  id: string;
  title: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
  version: number;
  items: Prisma.JsonValue;
  sourcing: Prisma.JsonValue;
  deliveryDetails: Prisma.JsonValue;
  deliveryDate: Date;
  commercialTerms: string | null;
};

type LockedSupplierRequest = {
  id: string;
  supplierId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  quoteRevision: number;
  quoteRevisions: Prisma.JsonValue;
};

type LockedSupplier = {
  id: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  gstin: string | null;
  applicationRequestId: string | null;
  isActive: boolean;
};

type ResolvedRevision = {
  grant: LockedSupplierRequest;
  supplier: LockedSupplier;
  revision: QuoteRevisionV1;
};

type RequestItem = RequestItemsV1['items'][number];

type SelectedLine = {
  requestItem: RequestItem;
  resolved: ResolvedRevision;
  quoteItem: QuoteRevisionItemV1;
  quantity: string;
  quantityMilli: bigint;
  subtotalPaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
};

function validId(value: unknown) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function conflict(message: string): never {
  throw new AwardConflictError(message);
}

function dateOnly(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AwardDocumentStorageCorruptionError();
  }
  return value.toISOString().slice(0, 10);
}

function indiaDate(now: Date) {
  return new Date(now.getTime() + 330 * 60 * 1_000).toISOString().slice(0, 10);
}

async function lockTenant(
  transaction: Prisma.TransactionClient,
  tenantId: string,
) {
  const [tenant] = await transaction.$queryRaw<LockedTenant[]>`
    SELECT
      "id", "name", "addressLine", "city", "state", "pin", "phone",
      "gstin", "isActive"
    FROM "Tenant"
    WHERE "id" = ${tenantId}
    FOR NO KEY UPDATE
  `;
  if (!tenant?.isActive) throw new AuthorizationError();
  return tenant;
}

async function requireActiveOwner(
  transaction: Prisma.TransactionClient,
  actor: { tenantId: string; userId: string },
) {
  const user = await transaction.user.findFirst({
    where: {
      tenantId: actor.tenantId,
      id: actor.userId,
      isActive: true,
      accountState: 'ACTIVE',
    },
    select: {
      id: true,
      tenantId: true,
      role: true,
      accountState: true,
      isActive: true,
    },
  });
  if (!user) throw new AuthorizationError();
  return requireOwner(user, 'award');
}

async function lockRequest(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
) {
  const [request] = await transaction.$queryRaw<LockedRequest[]>`
    SELECT
      "id", "title", "status", "version", "items", "sourcing",
      "deliveryDetails", "deliveryDate", "commercialTerms"
    FROM "ProcurementRequest"
    WHERE "tenantId" = ${tenantId}
      AND "id" = ${requestId}
    FOR UPDATE
  `;
  if (!request) throw new AwardNotFoundError();
  return request;
}

async function lockAllSupplierRequests(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
) {
  return transaction.$queryRaw<LockedSupplierRequest[]>`
    SELECT
      "id", "supplierId", "expiresAt", "revokedAt", "quoteRevision",
      "quoteRevisions"
    FROM "SupplierRequest"
    WHERE "tenantId" = ${tenantId}
      AND "requestId" = ${requestId}
    ORDER BY "id"
    FOR UPDATE
  `;
}

async function lockSelectedSuppliers(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  supplierIds: string[],
) {
  if (
    supplierIds.length < 1 ||
    supplierIds.length > DOCUMENT_LIMITS.awardSupplierSnapshots.suppliers
  ) {
    conflict(
      `An award may select at most ${DOCUMENT_LIMITS.awardSupplierSnapshots.suppliers} suppliers.`,
    );
  }
  const rows = await transaction.$queryRaw<LockedSupplier[]>(Prisma.sql`
    SELECT
      "id", "businessName", "contactName", "phone", "whatsappNumber",
      "email", "addressLine", "city", "state", "pin", "gstin",
      "applicationRequestId", "isActive"
    FROM "Supplier"
    WHERE "tenantId" = ${tenantId}
      AND "id" IN (${Prisma.join(supplierIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
  if (rows.length !== supplierIds.length) {
    conflict('Every awarded supplier must still be available in this tenant.');
  }
  return rows;
}

async function databaseClock(transaction: Prisma.TransactionClient) {
  const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT pg_catalog.clock_timestamp() AS "now"
  `;
  if (!clock || !(clock.now instanceof Date) || Number.isNaN(clock.now.getTime())) {
    throw new TypeError('PostgreSQL returned an invalid award clock.');
  }
  return clock.now;
}

function storedRequestDocuments(request: LockedRequest) {
  try {
    return validateRequestDocuments(request.items, request.sourcing);
  } catch (error) {
    if (error instanceof RequestDocumentValidationError) {
      throw new AwardDocumentStorageCorruptionError();
    }
    throw error;
  }
}

function requestedSupplierRevisionKeys(valid: ValidAwardInput) {
  const selections = valid.mode === 'WHOLE'
    ? [{
        supplierRequestId: valid.supplierRequestId,
        quoteRevision: valid.quoteRevision,
      }]
    : valid.selections;
  return new Set(selections.map((selection) =>
    `${selection.supplierRequestId}\u0000${selection.quoteRevision}`,
  ));
}

function selectedGrantIds(valid: ValidAwardInput) {
  return new Set(
    valid.mode === 'WHOLE'
      ? [valid.supplierRequestId]
      : valid.selections.map(({ supplierRequestId }) => supplierRequestId),
  );
}

function resolveSelectedRevisions(input: {
  valid: ValidAwardInput;
  request: LockedRequest;
  documents: { items: RequestItemsV1; sourcing: RequestSourcingV1 };
  grants: LockedSupplierRequest[];
  suppliers: LockedSupplier[];
  databaseNow: Date;
}) {
  const grantById = new Map(input.grants.map((grant) => [grant.id, grant]));
  const supplierById = new Map(input.suppliers.map((supplier) => [supplier.id, supplier]));
  const selectedKeys = requestedSupplierRevisionKeys(input.valid);
  const today = indiaDate(input.databaseNow);
  const resolved = new Map<string, ResolvedRevision>();
  for (const key of selectedKeys) {
    const separator = key.lastIndexOf('\u0000');
    const supplierRequestId = key.slice(0, separator);
    const requestedRevision = Number(key.slice(separator + 1));
    const grant = grantById.get(supplierRequestId);
    const supplier = grant ? supplierById.get(grant.supplierId) : undefined;
    if (
      !grant ||
      !supplier ||
      !supplier.isActive ||
      grant.revokedAt !== null ||
      !(grant.expiresAt instanceof Date) ||
      grant.expiresAt.getTime() <= input.databaseNow.getTime()
    ) {
      conflict('Every awarded line must use an active and available supplier quote.');
    }
    const eligibleItems = eligibleQuoteRequestItems({
      requestId: input.request.id,
      items: input.documents.items,
      sourcing: input.documents.sourcing,
      supplier: {
        id: supplier.id,
        applicationRequestId: supplier.applicationRequestId,
      },
    });
    if (eligibleItems.length === 0) {
      throw new PublicQuoteStorageCorruptionError();
    }
    const quoteRevisions = validateQuoteRevisionsDocument(
      grant.quoteRevisions,
      eligibleItems,
    );
    if (
      !Number.isSafeInteger(grant.quoteRevision) ||
      grant.quoteRevision < 1 ||
      grant.quoteRevision !== quoteRevisions.revisions.length ||
      requestedRevision !== grant.quoteRevision
    ) {
      conflict('Choose the latest supplier quote revision before awarding.');
    }
    const revision = latestQuoteRevision(quoteRevisions);
    if (!revision || revision.revision !== requestedRevision) {
      conflict('Choose the latest supplier quote revision before awarding.');
    }
    if (revision.validUntil < today) {
      conflict('Every awarded line must use an unexpired supplier quote.');
    }
    resolved.set(key, { grant, supplier, revision });
  }
  return resolved;
}

function awardSelections(
  valid: ValidAwardInput,
  requestItems: RequestItem[],
  revisions: Map<string, ResolvedRevision>,
): ValidAwardSelection[] {
  if (valid.mode === 'SPLIT') return valid.selections;
  const resolved = revisions.get(
    `${valid.supplierRequestId}\u0000${valid.quoteRevision}`,
  );
  if (!resolved) conflict('Choose the latest supplier quote revision before awarding.');
  const quotedByItem = new Map(
    resolved.revision.items.map((line) => [line.requestItemId, line]),
  );
  return requestItems.map((requestItem) => {
    const quoted = quotedByItem.get(requestItem.id);
    if (!quoted || quoted.noQuote) {
      conflict('A whole award requires a valid quote for every requested item.');
    }
    return {
      requestItemId: requestItem.id,
      supplierRequestId: valid.supplierRequestId,
      quoteRevision: valid.quoteRevision,
      quantity: requestItem.quantity,
    };
  });
}

function selectedLines(
  selections: ValidAwardSelection[],
  requestItems: RequestItem[],
  revisions: Map<string, ResolvedRevision>,
) {
  const requestItemById = new Map(requestItems.map((item) => [item.id, item]));
  const coverage = new Map(requestItems.map((item) => [item.id, BigInt(0)]));
  const lines = selections.map<SelectedLine>((selection) => {
    const requestItem = requestItemById.get(selection.requestItemId);
    const resolved = revisions.get(
      `${selection.supplierRequestId}\u0000${selection.quoteRevision}`,
    );
    const quoteItem = resolved?.revision.items.find(
      (item) => item.requestItemId === selection.requestItemId,
    );
    if (
      !requestItem ||
      !resolved ||
      !quoteItem ||
      quoteItem.noQuote ||
      quoteItem.availableQuantity === null ||
      quoteItem.unitRatePaise === null ||
      quoteItem.gstBasisPoints === null ||
      quoteItem.unit !== requestItem.unit
    ) {
      conflict('Every awarded line must use a comparable quoted request item.');
    }
    let quantityMilli: bigint;
    let availableMilli: bigint;
    try {
      quantityMilli = parseUnsignedFixed(selection.quantity, {
        label: 'Award quantity',
        scale: 3,
        maximumScaled: MAX_DECIMAL_18_3_SCALED,
        allowZero: false,
      });
      availableMilli = parseUnsignedFixed(quoteItem.availableQuantity, {
        label: 'Available quantity',
        scale: 3,
        maximumScaled: MAX_DECIMAL_18_3_SCALED,
        allowZero: false,
      });
    } catch {
      conflict('Awarded quantity is not comparable with the supplier quote.');
    }
    if (quantityMilli > availableMilli) {
      conflict('Awarded quantity exceeds the quoted available quantity.');
    }
    let totals: ReturnType<typeof calculateGst>;
    try {
      totals = calculateGst({
        amountPaise: multiplyPaise(quoteItem.unitRatePaise, selection.quantity),
        gstBasisPoints: quoteItem.gstBasisPoints,
        inclusive: quoteItem.taxInclusive,
      });
      coverage.set(
        requestItem.id,
        assertMaximum(
          (coverage.get(requestItem.id) ?? BigInt(0)) + quantityMilli,
          MAX_DECIMAL_18_3_SCALED,
          'Award coverage',
        ),
      );
    } catch {
      conflict('An awarded line total is outside the supported range.');
    }
    return {
      requestItem,
      resolved,
      quoteItem,
      quantity: formatScaledDecimal(quantityMilli, 3),
      quantityMilli,
      subtotalPaise: totals.netPaise,
      gstPaise: totals.gstPaise,
      totalPaise: totals.grossPaise,
    };
  });

  for (const requestItem of requestItems) {
    const requested = parseUnsignedFixed(requestItem.quantity, {
      label: 'Requested quantity',
      scale: 3,
      maximumScaled: MAX_DECIMAL_18_3_SCALED,
      allowZero: false,
    });
    if (coverage.get(requestItem.id) !== requested) {
      conflict('Award selections must cover every requested quantity exactly.');
    }
  }
  const itemOrder = new Map(requestItems.map((item, index) => [item.id, index]));
  return lines.sort((left, right) =>
    (itemOrder.get(left.requestItem.id) ?? 0) -
      (itemOrder.get(right.requestItem.id) ?? 0) ||
    left.resolved.grant.id.localeCompare(right.resolved.grant.id) ||
    left.resolved.revision.revision - right.resolved.revision.revision,
  );
}

function allocationDocument(lines: SelectedLine[]): AwardAllocationLinesV1 {
  return {
    v: 1,
    lines: lines.map<AwardAllocationLineV1>((line) => ({
      requestItemId: line.requestItem.id,
      supplierRequestId: line.resolved.grant.id,
      supplierId: line.resolved.supplier.id,
      quoteRevision: line.resolved.revision.revision,
      quantity: line.quantity,
      unit: line.requestItem.unit,
      unitRatePaise: line.quoteItem.unitRatePaise!,
      gstBasisPoints: line.quoteItem.gstBasisPoints!,
      subtotalPaise: line.subtotalPaise.toString(),
      gstPaise: line.gstPaise.toString(),
      totalPaise: line.totalPaise.toString(),
    })),
  };
}

function supplierDocument(lines: SelectedLine[]): AwardSupplierSnapshotsV1 {
  const selected = new Map<string, ResolvedRevision>();
  for (const line of lines) {
    selected.set(
      `${line.resolved.grant.id}\u0000${line.resolved.revision.revision}`,
      line.resolved,
    );
  }
  const suppliers = [...selected.values()]
    .sort((left, right) =>
      left.supplier.businessName.localeCompare(
        right.supplier.businessName,
        'en-IN',
      ) ||
      left.supplier.id.localeCompare(right.supplier.id) ||
      left.grant.id.localeCompare(right.grant.id),
    )
    .map<AwardSupplierSnapshotV1>((resolved) => ({
      supplierId: resolved.supplier.id,
      supplierRequestId: resolved.grant.id,
      quoteRevision: resolved.revision.revision,
      supplierName: resolved.supplier.businessName,
      contactName: resolved.supplier.contactName,
      phone: resolved.supplier.phone,
      whatsappNumber: resolved.supplier.whatsappNumber,
      email: resolved.supplier.email,
      addressLine: resolved.supplier.addressLine,
      city: resolved.supplier.city,
      state: resolved.supplier.state,
      pin: resolved.supplier.pin,
      gstin: resolved.supplier.gstin,
      submittedAt: resolved.revision.submittedAt,
      deliveryDate: resolved.revision.deliveryDate,
      validUntil: resolved.revision.validUntil,
      minimumOrder: resolved.revision.minimumOrder,
      freightPaise: resolved.revision.freightPaise,
      commercialTerms: resolved.revision.commercialTerms,
      notes: resolved.revision.notes,
      subtotalPaise: resolved.revision.subtotalPaise,
      gstPaise: resolved.revision.gstPaise,
      totalPaise: resolved.revision.totalPaise,
      lines: lines
        .filter((line) =>
          line.resolved.grant.id === resolved.grant.id &&
          line.resolved.revision.revision === resolved.revision.revision,
        )
        .map((line) => ({
          requestItemId: line.requestItem.id,
          itemKey: line.requestItem.itemKey,
          itemName: line.requestItem.name,
          requestedQuantity: line.requestItem.quantity,
          requestedUnit: line.requestItem.unit,
          requestedSpecification: line.requestItem.specification,
          taxInclusive: line.quoteItem.taxInclusive,
          suppliedBrand: line.quoteItem.suppliedBrand,
          suppliedPackSize: line.quoteItem.suppliedPackSize,
          suppliedQualityGrade: line.quoteItem.suppliedQualityGrade,
          substitution: line.quoteItem.substitution,
        })),
    }));
  return { v: 1, suppliers };
}

function deliveryDetails(value: Prisma.JsonValue) {
  if (!isRecord(value)) throw new AwardDocumentStorageCorruptionError();
  return {
    addressLine: value.addressLine as string,
    city: value.city as string,
    state: value.state as string,
    pin: value.pin as string,
    instructions: (value.instructions ?? null) as string | null,
  };
}

function deliveryDocument(
  request: LockedRequest,
  tenant: LockedTenant,
): AwardDeliverySnapshotV1 {
  return {
    v: 1,
    requestTitle: request.title,
    requestedDeliveryDate: dateOnly(request.deliveryDate),
    deliveryDetails: deliveryDetails(request.deliveryDetails),
    commercialTerms: request.commercialTerms,
    buyer: {
      name: tenant.name,
      addressLine: tenant.addressLine,
      city: tenant.city,
      state: tenant.state,
      pin: tenant.pin,
      phone: tenant.phone,
      gstin: tenant.gstin,
    },
  };
}

function ensureDocumentSizes(input: {
  allocationLines: AwardAllocationLinesV1;
  supplierSnapshots: AwardSupplierSnapshotsV1;
  deliverySnapshot: AwardDeliverySnapshotV1;
}) {
  try {
    assertBoundedJson(
      input.allocationLines,
      DOCUMENT_LIMITS.awardLines.jsonBytes,
      'Award allocation lines',
    );
    assertBoundedJson(
      input.supplierSnapshots,
      DOCUMENT_LIMITS.awardSupplierSnapshots.jsonBytes,
      'Award supplier snapshots',
    );
    assertBoundedJson(
      input.deliverySnapshot,
      DOCUMENT_LIMITS.awardDeliverySnapshot.jsonBytes,
      'Award delivery snapshot',
    );
  } catch (error) {
    if (error instanceof RangeError) throw new AwardSnapshotTooLargeError();
    throw new AwardDocumentStorageCorruptionError();
  }
}

function awardTotal(lines: SelectedLine[], suppliers: AwardSupplierSnapshotsV1) {
  let total = BigInt(0);
  try {
    for (const line of lines) {
      total = assertMaximum(
        total + line.totalPaise,
        MAX_SIGNED_BIGINT,
        'Award total',
      );
    }
    for (const supplier of suppliers.suppliers) {
      total = assertMaximum(
        total + BigInt(supplier.freightPaise),
        MAX_SIGNED_BIGINT,
        'Award total',
      );
    }
  } catch {
    conflict('The award total is outside the supported range.');
  }
  return total;
}

function awardDto(input: {
  id: string;
  requestId: string;
  rationale: string | null;
  totalPaise: bigint;
  createdAt: Date;
  allocationLines: unknown;
  supplierSnapshots: unknown;
  deliverySnapshot: unknown;
}) {
  const documents = validateAwardDocuments(input);
  return {
    id: input.id,
    requestId: input.requestId,
    rationale: input.rationale,
    totalPaise: documents.totalPaise,
    createdAt: input.createdAt.toISOString(),
    splitAward: documents.splitAward,
    suppliers: documents.supplierSnapshots.suppliers,
    lines: documents.allocationLines.lines,
    deliverySnapshot: documents.deliverySnapshot,
  };
}

function isUniqueConflict(error: unknown) {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002';
}

export async function createAward(input: {
  actor: { tenantId: string; userId: string };
  requestId: string;
  award: unknown;
}, client: AwardClient = prisma) {
  if (
    !validId(input.actor?.tenantId) ||
    !validId(input.actor?.userId) ||
    !validId(input.requestId)
  ) {
    throw new AwardNotFoundError();
  }
  const valid = validateAwardInput(input.award);

  try {
    return await withTenant(
      input.actor.tenantId,
      async (transaction) => {
        const tenant = await lockTenant(transaction, input.actor.tenantId);
        const owner = await requireActiveOwner(transaction, input.actor);
        const request = await lockRequest(
          transaction,
          input.actor.tenantId,
          input.requestId,
        );
        if (
          request.status !== 'OPEN' ||
          request.version !== valid.expectedRequestVersion
        ) {
          conflict(
            request.status === 'AWARDED'
              ? 'This request was already awarded.'
              : 'This request changed or is no longer open. Refresh before awarding.',
          );
        }

        const grants = await lockAllSupplierRequests(
          transaction,
          input.actor.tenantId,
          request.id,
        );
        const grantById = new Map(grants.map((grant) => [grant.id, grant]));
        const selectedIds = selectedGrantIds(valid);
        const selectedSupplierIds = [...selectedIds].map((grantId) => {
          const grant = grantById.get(grantId);
          if (!grant) {
            conflict('Every awarded supplier request must belong to this request.');
          }
          return grant.supplierId;
        });
        const uniqueSupplierIds = [...new Set(selectedSupplierIds)].sort();
        if (uniqueSupplierIds.length !== selectedSupplierIds.length) {
          conflict('Select at most one supplier request per supplier.');
        }
        const suppliers = await lockSelectedSuppliers(
          transaction,
          input.actor.tenantId,
          uniqueSupplierIds,
        );
        const now = await databaseClock(transaction);
        const documents = storedRequestDocuments(request);
        const revisions = resolveSelectedRevisions({
          valid,
          request,
          documents,
          grants,
          suppliers,
          databaseNow: now,
        });
        const selections = awardSelections(
          valid,
          documents.items.items,
          revisions,
        );
        const lines = selectedLines(
          selections,
          documents.items.items,
          revisions,
        );
        const allocationLines = allocationDocument(lines);
        const supplierSnapshots = supplierDocument(lines);
        const deliverySnapshot = deliveryDocument(request, tenant);
        const totalPaise = awardTotal(lines, supplierSnapshots);
        ensureDocumentSizes({
          allocationLines,
          supplierSnapshots,
          deliverySnapshot,
        });
        const validatedDocuments = validateAwardDocuments({
          allocationLines,
          supplierSnapshots,
          deliverySnapshot,
          totalPaise,
        });

        const updated = await transaction.procurementRequest.updateMany({
          where: {
            tenantId: input.actor.tenantId,
            id: request.id,
            status: 'OPEN',
            version: valid.expectedRequestVersion,
          },
          data: {
            status: 'AWARDED',
            version: valid.expectedRequestVersion + 1,
            awardedAt: now,
          },
        });
        if (updated.count !== 1) {
          conflict('This request changed or is no longer open. Refresh before awarding.');
        }
        await transaction.supplierRequest.updateMany({
          where: {
            tenantId: input.actor.tenantId,
            requestId: request.id,
          },
          data: { revokedAt: now },
        });
        const award = await transaction.award.create({
          data: {
            tenantId: input.actor.tenantId,
            requestId: request.id,
            rationale: valid.rationale,
            allocationLines:
              validatedDocuments.allocationLines as unknown as Prisma.InputJsonValue,
            supplierSnapshots:
              validatedDocuments.supplierSnapshots as unknown as Prisma.InputJsonValue,
            deliverySnapshot:
              validatedDocuments.deliverySnapshot as unknown as Prisma.InputJsonValue,
            totalPaise,
            awardedByUserId: owner.id,
            createdAt: now,
          },
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
        });
        await writeAuditEvent(transaction, {
          tenantId: input.actor.tenantId,
          actorUserId: owner.id,
          action: 'request.awarded',
          entityId: award.id,
          metadata: {
            lineCount: lines.length,
            supplierCount: supplierSnapshots.suppliers.length,
            splitAward: supplierSnapshots.suppliers.length > 1,
          },
        });
        return awardDto(award);
      },
      client,
    );
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new AwardConflictError('This request was already awarded.');
    }
    throw error;
  }
}
