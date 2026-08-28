import {
  Prisma,
  type PrismaClient,
  type ProcurementUnit,
  type UserRole,
} from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import {
  AuthorizationError,
  requireOwner,
} from '@/lib/auth/guards';
import {
  normalizeQuoteQuantityMilli,
  normalizeQuoteUnitRatePaise,
} from '@/lib/comparison/compare-quotes';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import { calculateGst, multiplyPaise } from '@/lib/domain/money';
import {
  assertMaximum,
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  MAX_SIGNED_BIGINT,
  parseUnsignedFixed,
} from '@/lib/domain/validation';
import { prisma } from '@/lib/prisma';

export const AWARD_BODY_BYTES = 512 * 1_024;
export const AWARD_MAX_SELECTIONS = 2_000;
export const AWARD_SUPPLIER_SNAPSHOTS_BYTES = 2 * 1_024 * 1_024;

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
    super('The selected supplier records exceed the supported award size.');
    this.name = 'AwardSnapshotTooLargeError';
  }
}

function postgresJsonText(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(postgresJsonText).join(', ')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${postgresJsonText(entry)}`)
      .join(', ')}}`;
  }
  throw new TypeError('Award supplier snapshots must be valid JSON.');
}

export function assertAwardSupplierSnapshotsSize(snapshots: unknown) {
  const bytes = new TextEncoder().encode(postgresJsonText(snapshots)).byteLength;
  if (bytes > AWARD_SUPPLIER_SNAPSHOTS_BYTES) {
    throw new AwardSnapshotTooLargeError();
  }
}

export type ValidAwardSelection = {
  requestItemId: string;
  supplierQuoteItemId: string;
  quantity: string;
};

export type ValidAwardInput =
  | {
      mode: 'WHOLE';
      expectedRequestVersion: number;
      supplierQuoteId: string;
      rationale: string;
    }
  | {
      mode: 'SPLIT';
      expectedRequestVersion: number;
      selections: ValidAwardSelection[];
      rationale: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      addError(errors, path ? `${path}.${key}` : key, 'This field is not allowed.');
    }
  }
}

function boundedText(
  value: unknown,
  path: string,
  maximumBytes: number,
  errors: ValidationErrors,
) {
  if (typeof value !== 'string' || !value.trim()) {
    addError(errors, path, 'This field is required.');
    return '';
  }
  const normalized = value.trim();
  if (new TextEncoder().encode(normalized).byteLength > maximumBytes) {
    addError(errors, path, `This field must not exceed ${maximumBytes} bytes.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    addError(errors, path, 'This field contains unsupported control characters.');
  }
  return normalized;
}

function boundedId(value: unknown, path: string, errors: ValidationErrors) {
  return boundedText(value, path, 200, errors);
}

function expectedVersion(value: unknown, errors: ValidationErrors) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    addError(errors, 'expectedRequestVersion', 'Expected version must be a positive integer.');
    return 0;
  }
  return Number(value);
}

function parseSelections(value: unknown, errors: ValidationErrors) {
  if (!Array.isArray(value) || value.length < 1 || value.length > AWARD_MAX_SELECTIONS) {
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
      return { requestItemId: '', supplierQuoteItemId: '', quantity: '' };
    }
    rejectUnknownKeys(
      raw,
      ['requestItemId', 'supplierQuoteItemId', 'quantity'],
      errors,
      `selections.${index}`,
    );
    const requestItemId = boundedId(
      raw.requestItemId,
      `selections.${index}.requestItemId`,
      errors,
    );
    const supplierQuoteItemId = boundedId(
      raw.supplierQuoteItemId,
      `selections.${index}.supplierQuoteItemId`,
      errors,
    );
    let quantity = '';
    try {
      const quantityMilli = parseUnsignedFixed(raw.quantity as never, {
        label: 'Award quantity',
        scale: 3,
        maximumScaled: MAX_DECIMAL_18_3_SCALED,
        allowZero: false,
      });
      quantity = quantityMilli % BigInt(1_000) === BigInt(0)
        ? (quantityMilli / BigInt(1_000)).toString()
        : `${quantityMilli / BigInt(1_000)}.${(quantityMilli % BigInt(1_000))
            .toString()
            .padStart(3, '0')
            .replace(/0+$/, '')}`;
    } catch {
      addError(
        errors,
        `selections.${index}.quantity`,
        'Enter a positive quantity with up to three decimal places.',
      );
    }
    const key = `${requestItemId}\u0000${supplierQuoteItemId}`;
    if (seen.has(key)) {
      addError(errors, `selections.${index}`, 'Select each supplier quote item once.');
    }
    seen.add(key);
    return { requestItemId, supplierQuoteItemId, quantity };
  });
}

function throwIfInvalid(errors: ValidationErrors) {
  if (Object.keys(errors).length > 0) throw new AwardValidationError(errors);
}

export function validateAwardInput(input: unknown): ValidAwardInput {
  const errors: ValidationErrors = Object.create(null) as ValidationErrors;
  if (!isRecord(input)) {
    throw new AwardValidationError({ award: ['Provide an award decision.'] });
  }
  const version = expectedVersion(input.expectedRequestVersion, errors);
  const rationale = boundedText(input.rationale, 'rationale', 500, errors);
  if (input.mode === 'WHOLE') {
    rejectUnknownKeys(
      input,
      ['mode', 'expectedRequestVersion', 'supplierQuoteId', 'rationale'],
      errors,
    );
    const supplierQuoteId = boundedId(input.supplierQuoteId, 'supplierQuoteId', errors);
    throwIfInvalid(errors);
    return {
      mode: 'WHOLE',
      expectedRequestVersion: version,
      supplierQuoteId,
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
      expectedRequestVersion: version,
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

type LockedRequest = {
  id: string;
  title: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
  version: number;
  deliveryDetails: Prisma.JsonValue;
  deliveryDate: Date;
};

type RequestItemRow = {
  id: string;
  name: string;
  quantity: Prisma.Decimal;
  unit: ProcurementUnit;
};

type LatestQuote = {
  id: string;
  supplierRequestId: string;
  supplierId: string;
  supplier: {
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
    isActive: boolean;
  };
  revision: number;
  freightPaise: bigint;
  deliveryDate: Date;
  validUntil: Date;
  commercialTerms: string | null;
  notes: string | null;
  submittedAt: Date;
  items: Array<{
    id: string;
    requestItemId: string;
    noQuote: boolean;
    availableQuantity: Prisma.Decimal | null;
    unit: ProcurementUnit | null;
    unitRatePaise: bigint | null;
    gstBasisPoints: number | null;
    taxInclusive: boolean;
    substitution: string | null;
  }>;
};

type SelectedLine = {
  requestItem: RequestItemRow;
  quote: LatestQuote;
  quoteItem: LatestQuote['items'][number];
  quantity: string;
  quantityMilli: bigint;
  normalizedUnitRatePaise: bigint;
  gstBasisPoints: number;
  subtotalPaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
};

function validId(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function snapshotText(value: string, maximumBytes: number, label: string) {
  if (new TextEncoder().encode(value).byteLength > maximumBytes) {
    conflict(`${label} is outside the supported award snapshot size.`);
  }
  return value;
}

function indiaDate(now: Date) {
  return new Date(now.getTime() + 330 * 60 * 1_000).toISOString().slice(0, 10);
}

function conflict(message: string): never {
  throw new AwardConflictError(message);
}

async function requireActiveOwner(
  transaction: Prisma.TransactionClient,
  actor: { tenantId: string; userId: string },
) {
  const [tenant] = await transaction.$queryRaw<Array<{
    id: string;
    name: string;
    addressLine: string;
    city: string;
    state: string;
    pin: string;
    phone: string;
    gstin: string | null;
    isActive: boolean;
  }>>`
    SELECT "id", "name", "addressLine", "city", "state", "pin", "phone", "gstin", "isActive"
    FROM "Tenant"
    WHERE "id" = ${actor.tenantId}
    FOR UPDATE
  `;
  if (!tenant?.isActive) throw new AuthorizationError();
  const [user] = await transaction.$queryRaw<
    Array<{ id: string; tenantId: string; role: UserRole; isActive: boolean }>
  >`
    SELECT "id", "tenantId", "role", "isActive"
    FROM "User"
    WHERE "tenantId" = ${actor.tenantId}
      AND "id" = ${actor.userId}
    FOR UPDATE
  `;
  if (!user) throw new AuthorizationError();
  return { owner: requireOwner(user, 'award'), tenant };
}

async function lockRequest(
  transaction: Prisma.TransactionClient,
  actor: { tenantId: string; userId: string },
  requestId: string,
) {
  const [request] = await transaction.$queryRaw<LockedRequest[]>`
    SELECT
      "id",
      "title",
      "status",
      "version",
      "deliveryDetails",
      "deliveryDate"
    FROM "ProcurementRequest"
    WHERE "tenantId" = ${actor.tenantId}
      AND "id" = ${requestId}
    FOR UPDATE
  `;
  if (!request) throw new AwardNotFoundError();
  return request;
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

async function requestItems(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
) {
  const items = await transaction.requestItem.findMany({
    where: { tenantId, requestId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, quantity: true, unit: true },
  });
  if (items.length === 0 || items.length > 1_000) {
    conflict('This request does not have a valid item list to award.');
  }
  return items;
}

async function latestQuotes(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
) {
  const grants = await transaction.supplierRequest.findMany({
    where: { tenantId, requestId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      supplierId: true,
      supplier: {
        select: {
          businessName: true,
          contactName: true,
          phone: true,
          whatsappNumber: true,
          email: true,
          addressLine: true,
          city: true,
          state: true,
          pin: true,
          gstin: true,
          isActive: true,
        },
      },
      quotes: {
        orderBy: { revision: 'desc' },
        take: 1,
        select: {
          id: true,
          revision: true,
          freightPaise: true,
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
            },
          },
        },
      },
    },
  });
  return grants.flatMap<LatestQuote>((grant) => {
    const quote = grant.quotes[0];
    return quote
      ? [
          {
            ...quote,
            supplierRequestId: grant.id,
            supplierId: grant.supplierId,
            supplier: grant.supplier,
          },
        ]
      : [];
  });
}

function quoteIsAwardable(quote: LatestQuote, indiaToday: string) {
  return quote.supplier.isActive && dateOnly(quote.validUntil) >= indiaToday;
}

function selectionsFor(
  valid: ValidAwardInput,
  items: RequestItemRow[],
  quotes: LatestQuote[],
  indiaToday: string,
) {
  if (valid.mode === 'SPLIT') return valid.selections;
  const quote = quotes.find(({ id }) => id === valid.supplierQuoteId);
  if (!quote || !quoteIsAwardable(quote, indiaToday)) {
    conflict('Choose the latest valid quote before recording an award.');
  }
  const quoteItems = new Map(quote.items.map((item) => [item.requestItemId, item]));
  return items.map((item) => {
    const quoteItem = quoteItems.get(item.id);
    if (!quoteItem) {
      conflict('A whole-basket award requires a valid quote for every requested item.');
    }
    return {
      requestItemId: item.id,
      supplierQuoteItemId: quoteItem.id,
      quantity: item.quantity.toString(),
    };
  });
}

function resolveSelectedLines(
  selections: ValidAwardSelection[],
  items: RequestItemRow[],
  quotes: LatestQuote[],
  indiaToday: string,
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const quoteItemById = new Map<
    string,
    { quote: LatestQuote; quoteItem: LatestQuote['items'][number] }
  >();
  for (const quote of quotes) {
    for (const quoteItem of quote.items) {
      quoteItemById.set(quoteItem.id, { quote, quoteItem });
    }
  }
  const coverage = new Map(items.map((item) => [item.id, BigInt(0)]));

  const lines = selections.map<SelectedLine>((selection) => {
    const requestItem = itemById.get(selection.requestItemId);
    const selected = quoteItemById.get(selection.supplierQuoteItemId);
    if (
      !requestItem ||
      !selected ||
      selected.quoteItem.requestItemId !== requestItem.id ||
      !quoteIsAwardable(selected.quote, indiaToday) ||
      selected.quoteItem.noQuote ||
      selected.quoteItem.availableQuantity === null ||
      selected.quoteItem.unit === null ||
      selected.quoteItem.unitRatePaise === null ||
      selected.quoteItem.gstBasisPoints === null
    ) {
      conflict('Every awarded line must use a latest valid quote for this request.');
    }
    const quantityMilli = parseUnsignedFixed(selection.quantity, {
      label: 'Award quantity',
      scale: 3,
      maximumScaled: MAX_DECIMAL_18_3_SCALED,
      allowZero: false,
    });
    let availableMilli: bigint | null;
    let normalizedUnitRatePaise: bigint | null;
    try {
      availableMilli = normalizeQuoteQuantityMilli(
        selected.quoteItem.availableQuantity.toString(),
        selected.quoteItem.unit,
        requestItem.unit,
      );
      normalizedUnitRatePaise = normalizeQuoteUnitRatePaise(
        selected.quoteItem.unitRatePaise,
        selected.quoteItem.unit,
        requestItem.unit,
      );
    } catch {
      availableMilli = null;
      normalizedUnitRatePaise = null;
    }
    if (
      availableMilli === null ||
      normalizedUnitRatePaise === null ||
      quantityMilli > availableMilli
    ) {
      conflict('Awarded quantity exceeds available comparable quote quantity.');
    }
    const currentCoverage = assertMaximum(
      (coverage.get(requestItem.id) ?? BigInt(0)) + quantityMilli,
      MAX_DECIMAL_18_3_SCALED,
      'Award coverage',
    );
    coverage.set(requestItem.id, currentCoverage);
    let lineAmount: bigint;
    let gst: ReturnType<typeof calculateGst>;
    try {
      lineAmount = multiplyPaise(
        normalizedUnitRatePaise,
        formatScaledDecimal(quantityMilli, 3),
      );
      gst = calculateGst({
        amountPaise: lineAmount,
        gstBasisPoints: selected.quoteItem.gstBasisPoints,
        inclusive: selected.quoteItem.taxInclusive,
      });
    } catch {
      conflict('An awarded line total is outside the supported range.');
    }
    return {
      requestItem,
      quote: selected.quote,
      quoteItem: selected.quoteItem,
      quantity: formatScaledDecimal(quantityMilli, 3),
      quantityMilli,
      normalizedUnitRatePaise,
      gstBasisPoints: selected.quoteItem.gstBasisPoints,
      subtotalPaise: gst.netPaise,
      gstPaise: gst.gstPaise,
      totalPaise: gst.grossPaise,
    };
  });

  for (const item of items) {
    const requested = parseUnsignedFixed(item.quantity, {
      label: 'Requested quantity',
      scale: 3,
      maximumScaled: MAX_DECIMAL_18_3_SCALED,
      allowZero: false,
    });
    if (coverage.get(item.id) !== requested) {
      conflict('Award selections must cover every requested quantity exactly.');
    }
  }
  return lines;
}

function supplierSnapshots(lines: SelectedLine[]) {
  const selectedQuotes = new Map(lines.map((line) => [line.quote.id, line.quote]));
  return [...selectedQuotes.values()]
    .sort(
      (left, right) =>
        left.supplier.businessName.localeCompare(right.supplier.businessName, 'en-IN') ||
        left.supplierId.localeCompare(right.supplierId) ||
        left.id.localeCompare(right.id),
    )
    .map((quote) => ({
      supplierId: quote.supplierId,
      supplierName: quote.supplier.businessName,
      contactName: quote.supplier.contactName,
      phone: quote.supplier.phone,
      whatsappNumber: quote.supplier.whatsappNumber,
      email: quote.supplier.email,
      addressLine: quote.supplier.addressLine,
      city: quote.supplier.city,
      state: quote.supplier.state,
      pin: quote.supplier.pin,
      gstin: quote.supplier.gstin,
      quoteId: quote.id,
      supplierRequestId: quote.supplierRequestId,
      revision: quote.revision,
      freightPaise: quote.freightPaise.toString(),
      deliveryDate: dateOnly(quote.deliveryDate),
      validUntil: dateOnly(quote.validUntil),
      commercialTerms: quote.commercialTerms,
      notes: quote.notes,
      submittedAt: quote.submittedAt.toISOString(),
    }));
}

function awardDto(
  award: {
    id: string;
    requestId: string;
    rationale: string | null;
    totalPaise: bigint;
    createdAt: Date;
  },
  suppliers: ReturnType<typeof supplierSnapshots>,
  lines: Array<{
    id: string;
    requestItemId: string;
    supplierQuoteItemId: string;
    supplierId: string;
    quantity: Prisma.Decimal;
    unit: ProcurementUnit;
    unitRatePaise: bigint;
    gstBasisPoints: number;
    subtotalPaise: bigint;
    gstPaise: bigint;
    totalPaise: bigint;
  }>,
) {
  return {
    id: award.id,
    requestId: award.requestId,
    rationale: award.rationale,
    totalPaise: award.totalPaise.toString(),
    createdAt: award.createdAt.toISOString(),
    splitAward: suppliers.length > 1,
    suppliers,
    lines: lines.map((line) => ({
      ...line,
      quantity: line.quantity.toString(),
      unitRatePaise: line.unitRatePaise.toString(),
      subtotalPaise: line.subtotalPaise.toString(),
      gstPaise: line.gstPaise.toString(),
      totalPaise: line.totalPaise.toString(),
    })),
  };
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

  return withTenant(
    input.actor.tenantId,
    async (transaction) => {
      const { owner, tenant } = await requireActiveOwner(transaction, input.actor);
      const request = await lockRequest(transaction, input.actor, input.requestId);
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
      const now = await databaseClock(transaction);
      const items = await requestItems(
        transaction,
        input.actor.tenantId,
        request.id,
      );
      const quotes = await latestQuotes(
        transaction,
        input.actor.tenantId,
        request.id,
      );
      const indiaToday = indiaDate(now);
      if (!quotes.some((quote) => quoteIsAwardable(quote, indiaToday))) {
        conflict('At least one latest valid supplier quote is required before awarding.');
      }
      const selections = selectionsFor(valid, items, quotes, indiaToday);
      const selectedLines = resolveSelectedLines(
        selections,
        items,
        quotes,
        indiaToday,
      );
      const suppliers = supplierSnapshots(selectedLines);
      assertAwardSupplierSnapshotsSize(suppliers);
      const selectedFreight = suppliers.reduce(
        (sum, supplier) =>
          assertMaximum(
            sum + BigInt(supplier.freightPaise),
            MAX_SIGNED_BIGINT,
            'Award freight',
          ),
        BigInt(0),
      );
      const totalPaise = selectedLines.reduce(
        (sum, line) =>
          assertMaximum(sum + line.totalPaise, MAX_SIGNED_BIGINT, 'Award total'),
        selectedFreight,
      );
      const deliverySnapshot = {
        requestTitle: request.title,
        requestedDeliveryDate: dateOnly(request.deliveryDate),
        deliveryDetails: request.deliveryDetails,
        buyer: {
          name: snapshotText(tenant.name, 160, 'Restaurant name'),
          addressLine: snapshotText(tenant.addressLine, 400, 'Restaurant address'),
          city: snapshotText(tenant.city, 120, 'Restaurant city'),
          state: snapshotText(tenant.state, 120, 'Restaurant state'),
          pin: snapshotText(tenant.pin, 12, 'Restaurant PIN'),
          phone: snapshotText(tenant.phone, 40, 'Restaurant phone'),
          gstin: tenant.gstin === null
            ? null
            : snapshotText(tenant.gstin, 20, 'Restaurant GSTIN'),
        },
      } satisfies Prisma.InputJsonObject;

      const award = await transaction.award.create({
        data: {
          tenantId: input.actor.tenantId,
          requestId: request.id,
          rationale: valid.rationale,
          supplierSnapshots: suppliers,
          deliverySnapshot,
          totalPaise,
          awardedByUserId: owner.id,
        },
        select: {
          id: true,
          requestId: true,
          rationale: true,
          totalPaise: true,
          createdAt: true,
        },
      });
      await transaction.awardLine.createMany({
        data: selectedLines.map((line) => ({
          tenantId: input.actor.tenantId,
          awardId: award.id,
          requestItemId: line.requestItem.id,
          supplierQuoteItemId: line.quoteItem.id,
          supplierId: line.quote.supplierId,
          quantity: line.quantity,
          unit: line.requestItem.unit,
          unitRatePaise: line.normalizedUnitRatePaise,
          gstBasisPoints: line.gstBasisPoints,
          subtotalPaise: line.subtotalPaise,
          gstPaise: line.gstPaise,
          totalPaise: line.totalPaise,
        })),
      });
      await transaction.procurementRequest.update({
        where: {
          tenantId_id: {
            tenantId: input.actor.tenantId,
            id: request.id,
          },
        },
        data: {
          status: 'AWARDED',
          awardedAt: now,
          version: { increment: 1 },
        },
      });
      await writeAuditEvent(transaction, {
        tenantId: input.actor.tenantId,
        actorUserId: owner.id,
        action: 'request.awarded',
        entityId: award.id,
        metadata: {
          lineCount: selectedLines.length,
          supplierCount: suppliers.length,
          splitAward: suppliers.length > 1,
          reason: valid.rationale,
        },
      });
      const lines = await transaction.awardLine.findMany({
        where: { tenantId: input.actor.tenantId, awardId: award.id },
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
        },
      });
      return awardDto(award, suppliers, lines);
    },
    client,
  );
}
