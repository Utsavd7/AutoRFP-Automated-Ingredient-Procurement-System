import { Prisma, type PrismaClient } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';
import {
  createOpaqueToken,
  digestOpaqueToken,
} from '@/lib/security/tokens';

export const PROCUREMENT_REQUEST_BODY_BYTES = 64 * 1_024;

export const PROCUREMENT_REQUEST_LIMITS = {
  idBytes: 200,
  titleBytes: 160,
  addressBytes: 400,
  placeBytes: 120,
  instructionsBytes: 1_000,
  termsBytes: 2_000,
  suppliers: 20,
  ingredients: 250,
  listPage: 50,
} as const;

type ValidationErrors = Record<string, string[]>;

export class ProcurementRequestValidationError extends Error {
  readonly code = 'INVALID_PROCUREMENT_REQUEST';
  readonly status = 422;

  constructor(readonly errors: ValidationErrors) {
    super('The procurement request contains invalid or unbounded fields.');
    this.name = 'ProcurementRequestValidationError';
  }
}

export class ProcurementRequestNotFoundError extends Error {
  readonly code = 'PROCUREMENT_REQUEST_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Procurement request not found.');
    this.name = 'ProcurementRequestNotFoundError';
  }
}

export class ProcurementRequestConflictError extends Error {
  readonly code = 'PROCUREMENT_REQUEST_CONFLICT';
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ProcurementRequestConflictError';
  }
}

type IngredientSelection =
  | { mode: 'ALL' }
  | { mode: 'SELECTED'; ingredientIds: string[] };

type DeliveryDetails = {
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  instructions?: string;
};

export type ValidProcurementRequestDraft = {
  title: string;
  menuId: string;
  ingredientSelection: IngredientSelection;
  supplierIds: string[];
  deliveryDetails: DeliveryDetails;
  deliveryDate: Date;
  quoteDeadline: Date;
  commercialTerms: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
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
  options: { nullable?: boolean } = {},
): string | null {
  if (options.nullable && (value === null || value === undefined || value === '')) {
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    addError(errors, path, 'This field is required.');
    return '';
  }
  const normalized = value.trim();
  if (byteLength(normalized) > maximumBytes) {
    addError(errors, path, `This field must not exceed ${maximumBytes} bytes.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    addError(errors, path, 'This field contains unsupported control characters.');
  }
  return normalized;
}

function boundedId(value: unknown, path: string, errors: ValidationErrors) {
  return boundedText(value, path, PROCUREMENT_REQUEST_LIMITS.idBytes, errors) ?? '';
}

function uniqueIds(
  value: unknown,
  path: string,
  maximum: number,
  errors: ValidationErrors,
) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    addError(errors, path, `Select between 1 and ${maximum} entries.`);
    return [];
  }
  const ids = value.map((item, index) => boundedId(item, `${path}.${index}`, errors));
  if (new Set(ids).size !== ids.length) {
    addError(errors, path, 'Duplicate entries are not allowed.');
  }
  return ids;
}

function parseDeliveryDetails(value: unknown, errors: ValidationErrors) {
  if (!isRecord(value)) {
    addError(errors, 'deliveryDetails', 'Delivery details are required.');
    return { addressLine: '', city: '', state: '', pin: '' };
  }
  rejectUnknownKeys(
    value,
    ['addressLine', 'city', 'state', 'pin', 'instructions'],
    errors,
    'deliveryDetails',
  );
  const addressLine = boundedText(
    value.addressLine,
    'deliveryDetails.addressLine',
    PROCUREMENT_REQUEST_LIMITS.addressBytes,
    errors,
  ) ?? '';
  const city = boundedText(
    value.city,
    'deliveryDetails.city',
    PROCUREMENT_REQUEST_LIMITS.placeBytes,
    errors,
  ) ?? '';
  const state = boundedText(
    value.state,
    'deliveryDetails.state',
    PROCUREMENT_REQUEST_LIMITS.placeBytes,
    errors,
  ) ?? '';
  const pin = boundedText(value.pin, 'deliveryDetails.pin', 6, errors) ?? '';
  if (pin && !/^[1-9][0-9]{5}$/.test(pin)) {
    addError(errors, 'deliveryDetails.pin', 'Enter a valid six-digit Indian PIN.');
  }
  const instructions = boundedText(
    value.instructions,
    'deliveryDetails.instructions',
    PROCUREMENT_REQUEST_LIMITS.instructionsBytes,
    errors,
    { nullable: true },
  );
  return {
    addressLine,
    city,
    state,
    pin,
    ...(instructions ? { instructions } : {}),
  };
}

function parseDeliveryDate(value: unknown, errors: ValidationErrors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    addError(errors, 'deliveryDate', 'Use a valid India delivery date in YYYY-MM-DD format.');
    return new Date(Number.NaN);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    addError(errors, 'deliveryDate', 'Use a valid India delivery date in YYYY-MM-DD format.');
  }
  return date;
}

function parseQuoteDeadline(value: unknown, now: Date, errors: ValidationErrors) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    addError(errors, 'quoteDeadline', 'Use an ISO timestamp with an explicit timezone.');
    return new Date(Number.NaN);
  }
  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) {
    addError(errors, 'quoteDeadline', 'Use a valid quote deadline.');
  } else if (deadline.getTime() <= now.getTime()) {
    addError(errors, 'quoteDeadline', 'Quote deadline must be in the future.');
  }
  return deadline;
}

function validateDeadlineBeforeIndiaDelivery(
  deadline: Date,
  deliveryDate: Date,
  errors: ValidationErrors,
) {
  if (Number.isNaN(deadline.getTime()) || Number.isNaN(deliveryDate.getTime())) return;
  const indiaDeliveryStart = deliveryDate.getTime() - 330 * 60 * 1_000;
  if (deadline.getTime() >= indiaDeliveryStart) {
    addError(errors, 'quoteDeadline', 'Quote deadline must be before the India delivery date.');
  }
}

function parseSelection(value: unknown, errors: ValidationErrors): IngredientSelection {
  if (!isRecord(value)) {
    addError(errors, 'ingredientSelection', 'Choose all menu ingredients or an explicit selection.');
    return { mode: 'ALL' };
  }
  if (value.mode === 'ALL') {
    rejectUnknownKeys(value, ['mode'], errors, 'ingredientSelection');
    return { mode: 'ALL' };
  }
  if (value.mode === 'SELECTED') {
    rejectUnknownKeys(value, ['mode', 'ingredientIds'], errors, 'ingredientSelection');
    return {
      mode: 'SELECTED',
      ingredientIds: uniqueIds(
        value.ingredientIds,
        'ingredientSelection.ingredientIds',
        PROCUREMENT_REQUEST_LIMITS.ingredients,
        errors,
      ),
    };
  }
  addError(errors, 'ingredientSelection.mode', 'Choose ALL or SELECTED.');
  return { mode: 'ALL' };
}

function throwIfInvalid(errors: ValidationErrors) {
  if (Object.keys(errors).length > 0) {
    throw new ProcurementRequestValidationError(errors);
  }
}

export function validateProcurementRequestDraftInput(
  input: unknown,
  now = new Date(),
): ValidProcurementRequestDraft {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({
      request: ['Provide a procurement request object.'],
    });
  }
  rejectUnknownKeys(
    input,
    [
      'title',
      'menuId',
      'ingredientSelection',
      'supplierIds',
      'deliveryDetails',
      'deliveryDate',
      'quoteDeadline',
      'commercialTerms',
    ],
    errors,
  );
  const title = boundedText(
    input.title,
    'title',
    PROCUREMENT_REQUEST_LIMITS.titleBytes,
    errors,
  ) ?? '';
  const menuId = boundedId(input.menuId, 'menuId', errors);
  const ingredientSelection = parseSelection(input.ingredientSelection, errors);
  const supplierIds = uniqueIds(
    input.supplierIds,
    'supplierIds',
    PROCUREMENT_REQUEST_LIMITS.suppliers,
    errors,
  );
  const deliveryDetails = parseDeliveryDetails(input.deliveryDetails, errors);
  const deliveryDate = parseDeliveryDate(input.deliveryDate, errors);
  const quoteDeadline = parseQuoteDeadline(input.quoteDeadline, now, errors);
  validateDeadlineBeforeIndiaDelivery(quoteDeadline, deliveryDate, errors);
  const commercialTerms = boundedText(
    input.commercialTerms,
    'commercialTerms',
    PROCUREMENT_REQUEST_LIMITS.termsBytes,
    errors,
    { nullable: true },
  );
  throwIfInvalid(errors);
  return {
    title,
    menuId,
    ingredientSelection,
    supplierIds,
    deliveryDetails,
    deliveryDate,
    quoteDeadline,
    commercialTerms,
  };
}

export type ValidDraftPatch = Partial<
  Pick<
    ValidProcurementRequestDraft,
    | 'title'
    | 'supplierIds'
    | 'deliveryDetails'
    | 'deliveryDate'
    | 'quoteDeadline'
    | 'commercialTerms'
  >
>;

export function validateDraftPatchInput(input: unknown, now = new Date()): ValidDraftPatch {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({ patch: ['Provide an update object.'] });
  }
  const allowed = [
    'title',
    'supplierIds',
    'deliveryDetails',
    'deliveryDate',
    'quoteDeadline',
    'commercialTerms',
  ];
  rejectUnknownKeys(input, allowed, errors);
  if (Object.keys(input).length === 0) addError(errors, 'patch', 'Provide at least one change.');
  const patch: ValidDraftPatch = {};
  if (Object.hasOwn(input, 'title')) {
    patch.title = boundedText(
      input.title,
      'title',
      PROCUREMENT_REQUEST_LIMITS.titleBytes,
      errors,
    ) ?? '';
  }
  if (Object.hasOwn(input, 'supplierIds')) {
    patch.supplierIds = uniqueIds(
      input.supplierIds,
      'supplierIds',
      PROCUREMENT_REQUEST_LIMITS.suppliers,
      errors,
    );
  }
  if (Object.hasOwn(input, 'deliveryDetails')) {
    patch.deliveryDetails = parseDeliveryDetails(input.deliveryDetails, errors);
  }
  if (Object.hasOwn(input, 'deliveryDate')) {
    patch.deliveryDate = parseDeliveryDate(input.deliveryDate, errors);
  }
  if (Object.hasOwn(input, 'quoteDeadline')) {
    patch.quoteDeadline = parseQuoteDeadline(input.quoteDeadline, now, errors);
  }
  if (Object.hasOwn(input, 'commercialTerms')) {
    patch.commercialTerms = boundedText(
      input.commercialTerms,
      'commercialTerms',
      PROCUREMENT_REQUEST_LIMITS.termsBytes,
      errors,
      { nullable: true },
    );
  }
  if (patch.deliveryDate && patch.quoteDeadline) {
    validateDeadlineBeforeIndiaDelivery(patch.quoteDeadline, patch.deliveryDate, errors);
  }
  throwIfInvalid(errors);
  return patch;
}

export function validateExpectedVersion(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new ProcurementRequestValidationError({
      expectedVersion: ['Expected version must be a positive integer.'],
    });
  }
  return Number(value);
}

export function validateOpenRequestInput(input: unknown) {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({
      request: ['Provide an open request object.'],
    });
  }
  rejectUnknownKeys(input, ['expectedVersion'], errors);
  let expectedVersion = 0;
  try {
    expectedVersion = validateExpectedVersion(input.expectedVersion);
  } catch (error) {
    if (error instanceof ProcurementRequestValidationError) {
      Object.assign(errors, error.errors);
    } else throw error;
  }
  throwIfInvalid(errors);
  return { expectedVersion };
}

export function validateLinkActionInput(input: unknown) {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({ action: ['Provide a link action.'] });
  }
  rejectUnknownKeys(input, ['action', 'supplierRequestId', 'expectedVersion'], errors);
  const action = input.action === 'rotate' || input.action === 'revoke' ? input.action : null;
  if (!action) addError(errors, 'action', 'Choose rotate or revoke.');
  const supplierRequestId = boundedId(
    input.supplierRequestId,
    'supplierRequestId',
    errors,
  );
  let expectedVersion = 0;
  try {
    expectedVersion = validateExpectedVersion(input.expectedVersion);
  } catch (error) {
    if (error instanceof ProcurementRequestValidationError) {
      Object.assign(errors, error.errors);
    } else throw error;
  }
  throwIfInvalid(errors);
  return { action: action!, supplierRequestId, expectedVersion };
}

export function validateRepeatRequestInput(input: unknown, now = new Date()) {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({ request: ['Provide repeat request details.'] });
  }
  rejectUnknownKeys(
    input,
    ['expectedSourceVersion', 'title', 'deliveryDate', 'quoteDeadline'],
    errors,
  );
  let expectedSourceVersion = 0;
  try {
    expectedSourceVersion = validateExpectedVersion(input.expectedSourceVersion);
  } catch (error) {
    if (error instanceof ProcurementRequestValidationError) Object.assign(errors, error.errors);
    else throw error;
  }
  const title = boundedText(input.title, 'title', PROCUREMENT_REQUEST_LIMITS.titleBytes, errors) ?? '';
  const deliveryDate = parseDeliveryDate(input.deliveryDate, errors);
  const quoteDeadline = parseQuoteDeadline(input.quoteDeadline, now, errors);
  validateDeadlineBeforeIndiaDelivery(quoteDeadline, deliveryDate, errors);
  throwIfInvalid(errors);
  return { expectedSourceVersion, title, deliveryDate, quoteDeadline };
}

type RequestCursor = { createdAt: Date; id: string };

export function encodeRequestCursor(cursor: RequestCursor) {
  return Buffer.from(
    JSON.stringify([cursor.createdAt.toISOString(), cursor.id]),
    'utf8',
  ).toString('base64url');
}

export function decodeRequestCursor(value: string): RequestCursor {
  const errors: ValidationErrors = {};
  try {
    if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) throw new Error();
    const parsed: unknown = JSON.parse(decoded);
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error();
    const createdAt = new Date(parsed[0] as string);
    const id = boundedId(parsed[1], 'cursor', errors);
    if (Number.isNaN(createdAt.getTime()) || errors.cursor) throw new Error();
    return { createdAt, id };
  } catch {
    throw new ProcurementRequestValidationError({ cursor: ['Cursor is invalid.'] });
  }
}

type RequestActor = { tenantId: string; userId: string };

type RequestClient = Pick<PrismaClient, '$queryRaw' | '$transaction'> &
  TenantTransactionHost;

type IssuedToken = { raw: string; digest: string };

export type RequestServiceOptions = {
  now?: () => Date;
  transactionClock?: (transaction: Prisma.TransactionClient) => Promise<Date>;
  tokenFactory?: () => IssuedToken;
  shareBaseUrl?: string;
};

const MAX_LINK_LIFETIME_MS = 14 * 24 * 60 * 60 * 1_000;

const safeSupplierRequestSelect = {
  id: true,
  tenantId: true,
  requestId: true,
  supplierId: true,
  expiresAt: true,
  revokedAt: true,
  viewedAt: true,
  createdAt: true,
  supplier: {
    select: {
      id: true,
      businessName: true,
      contactName: true,
      phone: true,
      whatsappNumber: true,
      email: true,
      isActive: true,
    },
  },
} satisfies Prisma.SupplierRequestSelect;

const requestDetailInclude = {
  items: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  supplierRequests: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: safeSupplierRequestSelect,
  },
} satisfies Prisma.ProcurementRequestInclude;

async function postgresTransactionClock(
  transaction: Prisma.TransactionClient,
) {
  const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  if (!clock || !(clock.now instanceof Date) || Number.isNaN(clock.now.getTime())) {
    throw new TypeError('PostgreSQL returned an invalid transaction clock.');
  }
  return clock.now;
}

function optionsWithDefaults(options: RequestServiceOptions | undefined) {
  return {
    now: options?.now ?? (() => new Date()),
    transactionClock: options?.transactionClock ?? postgresTransactionClock,
    tokenFactory:
      options?.tokenFactory ?? (() => createOpaqueToken('supplier-request')),
    shareBaseUrl: options?.shareBaseUrl,
  };
}

async function transactionTime(
  transaction: Prisma.TransactionClient,
  clock: (transaction: Prisma.TransactionClient) => Promise<Date>,
) {
  const current = await clock(transaction);
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
    throw new TypeError('The transaction clock returned an invalid timestamp.');
  }
  return new Date(current.getTime());
}

function validateActor(actor: RequestActor): RequestActor {
  const errors: ValidationErrors = {};
  const tenantId = boundedId(actor?.tenantId, 'tenantId', errors);
  const userId = boundedId(actor?.userId, 'userId', errors);
  if (Object.keys(errors).length > 0) throw new AuthorizationError();
  return { tenantId, userId };
}

function validateRequestId(value: unknown) {
  const errors: ValidationErrors = {};
  const id = boundedId(value, 'requestId', errors);
  throwIfInvalid(errors);
  return id;
}

async function requireActiveActor(
  transaction: Prisma.TransactionClient,
  actor: RequestActor,
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
}

async function activeSuppliers(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  supplierIds: string[],
) {
  const suppliers = await transaction.$queryRaw<
    Array<{ id: string; isActive: boolean }>
  >`
    SELECT "id", "isActive"
    FROM "Supplier"
    WHERE "tenantId" = ${tenantId}
      AND "id" IN (${Prisma.join(supplierIds)})
    ORDER BY "id"
    FOR UPDATE
  `;
  if (suppliers.length !== supplierIds.length) {
    throw new ProcurementRequestNotFoundError();
  }
  if (suppliers.some(({ isActive }) => !isActive)) {
    throw new ProcurementRequestConflictError(
      'Only active suppliers can receive this procurement request.',
    );
  }
  return suppliers;
}

function issueToken(factory: () => IssuedToken) {
  const token = factory();
  if (
    !token ||
    typeof token.raw !== 'string' ||
    typeof token.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token.digest) ||
    digestOpaqueToken('supplier-request', token.raw) !== token.digest
  ) {
    throw new TypeError('The supplier link token generator returned invalid output.');
  }
  return token;
}

function linkExpiry(now: Date, quoteDeadline: Date) {
  return new Date(
    Math.min(quoteDeadline.getTime(), now.getTime() + MAX_LINK_LIFETIME_MS),
  );
}

function shareBaseUrl(configured: string | undefined) {
  const candidate =
    configured ??
    process.env.NEXTAUTH_URL ??
    (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000');
  if (!candidate) {
    throw new ProcurementRequestConflictError(
      'Configure the application URL before issuing supplier links.',
    );
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ProcurementRequestConflictError(
      'Configure a valid application URL before issuing supplier links.',
    );
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.username || url.password || url.search || url.hash || (!local && url.protocol !== 'https:')) {
    throw new ProcurementRequestConflictError(
      'Configure a secure application URL before issuing supplier links.',
    );
  }
  return url.origin;
}

function supplierShareUrl(baseUrl: string, rawToken: string) {
  const url = new URL('/quote', `${baseUrl}/`);
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}

type LockedRequest = {
  id: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
  version: number;
  deliveryDate: Date;
  quoteDeadline: Date;
};

async function lockRequest(
  transaction: Prisma.TransactionClient,
  actor: RequestActor,
  requestId: string,
) {
  const [locked] = await transaction.$queryRaw<LockedRequest[]>`
    SELECT "id", "status", "version", "deliveryDate", "quoteDeadline"
    FROM "ProcurementRequest"
    WHERE "tenantId" = ${actor.tenantId}
      AND "id" = ${requestId}
    FOR UPDATE
  `;
  if (!locked) throw new ProcurementRequestNotFoundError();
  return locked;
}

function assertVersionAndStatus(
  request: LockedRequest,
  expectedVersion: number,
  status: LockedRequest['status'],
) {
  if (request.version !== expectedVersion) {
    throw new ProcurementRequestConflictError(
      'This request changed. Refresh it before trying again.',
    );
  }
  if (request.status !== status) {
    throw new ProcurementRequestConflictError(
      status === 'DRAFT'
        ? 'Only a draft request can be changed or opened.'
        : 'Supplier links can only be changed while a request is open.',
    );
  }
}

async function requestDetails(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
) {
  const request = await transaction.procurementRequest.findFirst({
    where: { tenantId, id: requestId },
    include: requestDetailInclude,
  });
  if (!request) throw new ProcurementRequestNotFoundError();
  return request;
}

async function replaceSupplierRequestTokens(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    requestId: string;
    expiresAt: Date;
    grants: Array<{ id: string; tokenDigest: string }>;
  },
) {
  const rows = input.grants.map(({ id, tokenDigest }) =>
    Prisma.sql`(${id}, ${tokenDigest})`,
  );
  const updated = await transaction.$executeRaw`
    UPDATE "SupplierRequest" AS target
    SET "tokenDigest" = issued."tokenDigest"::CHAR(64),
        "expiresAt" = ${input.expiresAt},
        "revokedAt" = NULL,
        "viewedAt" = NULL
    FROM (VALUES ${Prisma.join(rows)}) AS issued("id", "tokenDigest")
    WHERE target."tenantId" = ${input.tenantId}
      AND target."requestId" = ${input.requestId}
      AND target."id" = issued."id"
  `;
  if (updated !== input.grants.length) {
    throw new ProcurementRequestNotFoundError();
  }
}

async function writeSupplierLinkCreatedAuditEvents(
  transaction: Prisma.TransactionClient,
  actor: RequestActor,
  supplierRequestIds: string[],
) {
  await transaction.auditEvent.createMany({
    data: supplierRequestIds.map((entityId) => ({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'supplier-link.created',
      entityType: 'SupplierRequest',
      entityId,
    })),
  });
}

export async function listProcurementRequests(
  input: {
    actor: RequestActor;
    cursor?: string;
    limit?: number;
  },
  client: RequestClient = prisma,
) {
  const actor = validateActor(input.actor);
  const limit = input.limit ?? 25;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > PROCUREMENT_REQUEST_LIMITS.listPage
  ) {
    throw new ProcurementRequestValidationError({
      limit: [
        `Limit must be between 1 and ${PROCUREMENT_REQUEST_LIMITS.listPage}.`,
      ],
    });
  }
  const cursor = input.cursor ? decodeRequestCursor(input.cursor) : undefined;

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const requests = await transaction.procurementRequest.findMany({
        where: {
          tenantId: actor.tenantId,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          tenantId: true,
          title: true,
          status: true,
          version: true,
          menuId: true,
          deliveryDetails: true,
          deliveryDate: true,
          quoteDeadline: true,
          commercialTerms: true,
          openedAt: true,
          awardedAt: true,
          cancelledAt: true,
          createdByUserId: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { items: true, supplierRequests: true } },
        },
      });
      const hasMore = requests.length > limit;
      if (hasMore) requests.pop();
      const last = requests.at(-1);
      return {
        requests,
        nextCursor:
          hasMore && last
            ? encodeRequestCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    },
    client,
  );
}

export async function createProcurementRequestDraft(
  input: { actor: RequestActor; draft: unknown },
  client: RequestClient = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const serviceOptions = optionsWithDefaults(options);
  const now = serviceOptions.now();
  const draft = validateProcurementRequestDraftInput(input.draft, now);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const [menu] = await transaction.$queryRaw<
        Array<{ id: string; status: 'DRAFT' | 'APPROVED'; version: number }>
      >`
        SELECT "id", "status", "version"
        FROM "Menu"
        WHERE "tenantId" = ${actor.tenantId}
          AND "id" = ${draft.menuId}
        FOR UPDATE
      `;
      if (!menu) throw new ProcurementRequestNotFoundError();
      if (menu.status !== 'APPROVED') {
        throw new ProcurementRequestConflictError(
          'Approve the current menu before creating a procurement request.',
        );
      }

      const selectedIds =
        draft.ingredientSelection.mode === 'SELECTED'
          ? draft.ingredientSelection.ingredientIds
          : undefined;
      const ingredients = await transaction.ingredient.findMany({
        where: {
          tenantId: actor.tenantId,
          recipe: {
            menuId: draft.menuId,
          },
          ...(selectedIds ? { id: { in: selectedIds } } : {}),
        },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          quantity: true,
          unit: true,
        },
      });
      if (
        ingredients.length === 0 ||
        ingredients.length > PROCUREMENT_REQUEST_LIMITS.ingredients ||
        (selectedIds && ingredients.length !== selectedIds.length)
      ) {
        if (ingredients.length > PROCUREMENT_REQUEST_LIMITS.ingredients) {
          throw new ProcurementRequestValidationError({
            ingredientSelection: [
              `A request can include up to ${PROCUREMENT_REQUEST_LIMITS.ingredients} ingredient lines.`,
            ],
          });
        }
        throw new ProcurementRequestNotFoundError();
      }
      const suppliers = await activeSuppliers(
        transaction,
        actor.tenantId,
        draft.supplierIds,
      );
      const placeholderGrants = suppliers.map(({ id }) => ({
        supplierId: id,
        token: issueToken(serviceOptions.tokenFactory),
      }));

      return transaction.procurementRequest.create({
        data: {
          title: draft.title,
          status: 'DRAFT',
          deliveryDetails: draft.deliveryDetails,
          deliveryDate: draft.deliveryDate,
          quoteDeadline: draft.quoteDeadline,
          commercialTerms: draft.commercialTerms,
          tenant: { connect: { id: actor.tenantId } },
          menu: {
            connect: {
              tenantId_id: { tenantId: actor.tenantId, id: draft.menuId },
            },
          },
          createdBy: {
            connect: {
              tenantId_id: { tenantId: actor.tenantId, id: actor.userId },
            },
          },
          items: {
            create: ingredients.map((ingredient) => ({
              name: ingredient.name,
              quantity: ingredient.quantity,
              unit: ingredient.unit,
              tenant: { connect: { id: actor.tenantId } },
            })),
          },
          supplierRequests: {
            create: placeholderGrants.map(({ supplierId, token }) => ({
              tokenDigest: token.digest,
              expiresAt: linkExpiry(now, draft.quoteDeadline),
              tenant: { connect: { id: actor.tenantId } },
              supplier: {
                connect: {
                  tenantId_id: { tenantId: actor.tenantId, id: supplierId },
                },
              },
            })),
          },
        },
        include: requestDetailInclude,
      });
    },
    client,
  );
}

export async function getProcurementRequest(
  input: { actor: RequestActor; requestId: string },
  client: RequestClient = prisma,
) {
  const actor = validateActor(input.actor);
  const requestId = validateRequestId(input.requestId);
  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      await lockRequest(transaction, actor, requestId);
      return requestDetails(transaction, actor.tenantId, requestId);
    },
    client,
  );
}

export async function updateProcurementRequestDraft(
  input: {
    actor: RequestActor;
    requestId: string;
    expectedVersion: unknown;
    patch: unknown;
  },
  client: RequestClient = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const requestId = validateRequestId(input.requestId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);
  const serviceOptions = optionsWithDefaults(options);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const locked = await lockRequest(transaction, actor, requestId);
      assertVersionAndStatus(locked, expectedVersion, 'DRAFT');
      const now = await transactionTime(
        transaction,
        serviceOptions.transactionClock,
      );
      const patch = validateDraftPatchInput(input.patch, now);

      const deliveryDate = patch.deliveryDate ?? locked.deliveryDate;
      const quoteDeadline = patch.quoteDeadline ?? locked.quoteDeadline;
      const timelineErrors: ValidationErrors = {};
      if (quoteDeadline.getTime() <= now.getTime()) {
        addError(
          timelineErrors,
          'quoteDeadline',
          'Quote deadline must be in the future.',
        );
      }
      validateDeadlineBeforeIndiaDelivery(
        quoteDeadline,
        deliveryDate,
        timelineErrors,
      );
      throwIfInvalid(timelineErrors);

      if (patch.supplierIds) {
        const suppliers = await activeSuppliers(
          transaction,
          actor.tenantId,
          patch.supplierIds,
        );
        const placeholders = suppliers.map(({ id }) => ({
          supplierId: id,
          token: issueToken(serviceOptions.tokenFactory),
        }));
        await transaction.supplierRequest.deleteMany({
          where: { tenantId: actor.tenantId, requestId },
        });
        await transaction.supplierRequest.createMany({
          data: placeholders.map(({ supplierId, token }) => ({
            tenantId: actor.tenantId,
            requestId,
            supplierId,
            tokenDigest: token.digest,
            expiresAt: linkExpiry(now, quoteDeadline),
          })),
        });
      } else {
        await transaction.supplierRequest.updateMany({
          where: { tenantId: actor.tenantId, requestId },
          data: { expiresAt: linkExpiry(now, quoteDeadline) },
        });
      }

      await transaction.procurementRequest.update({
        where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.deliveryDetails !== undefined
            ? { deliveryDetails: patch.deliveryDetails }
            : {}),
          ...(patch.deliveryDate !== undefined
            ? { deliveryDate: patch.deliveryDate }
            : {}),
          ...(patch.quoteDeadline !== undefined
            ? { quoteDeadline: patch.quoteDeadline }
            : {}),
          ...(patch.commercialTerms !== undefined
            ? { commercialTerms: patch.commercialTerms }
            : {}),
          version: { increment: 1 },
        },
      });
      return requestDetails(transaction, actor.tenantId, requestId);
    },
    client,
  );
}

export async function openProcurementRequest(
  input: {
    actor: RequestActor;
    requestId: string;
    expectedVersion: unknown;
  },
  client: RequestClient = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const requestId = validateRequestId(input.requestId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);
  const serviceOptions = optionsWithDefaults(options);
  const baseUrl = shareBaseUrl(serviceOptions.shareBaseUrl);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const locked = await lockRequest(transaction, actor, requestId);
      assertVersionAndStatus(locked, expectedVersion, 'DRAFT');
      const current = await requestDetails(
        transaction,
        actor.tenantId,
        requestId,
      );
      if (current.items.length === 0 || current.supplierRequests.length === 0) {
        throw new ProcurementRequestConflictError(
          'Add reviewed demand and at least one active supplier before opening.',
        );
      }
      await activeSuppliers(
        transaction,
        actor.tenantId,
        current.supplierRequests.map(({ supplierId }) => supplierId),
      );
      const now = await transactionTime(
        transaction,
        serviceOptions.transactionClock,
      );
      if (locked.quoteDeadline.getTime() <= now.getTime()) {
        throw new ProcurementRequestConflictError(
          'Set a future quote deadline before opening this request.',
        );
      }

      const expiresAt = linkExpiry(now, locked.quoteDeadline);
      const issued = current.supplierRequests.map((supplierRequest) => ({
        supplierRequest,
        token: issueToken(serviceOptions.tokenFactory),
      }));
      await replaceSupplierRequestTokens(transaction, {
        tenantId: actor.tenantId,
        requestId,
        expiresAt,
        grants: issued.map(({ supplierRequest, token }) => ({
          id: supplierRequest.id,
          tokenDigest: token.digest,
        })),
      });
      await transaction.procurementRequest.update({
        where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
        data: { status: 'OPEN', openedAt: now, version: { increment: 1 } },
      });
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'request.opened',
        entityId: requestId,
        metadata: {
          itemCount: current.items.length,
          supplierCount: current.supplierRequests.length,
        },
      });
      await writeSupplierLinkCreatedAuditEvents(
        transaction,
        actor,
        issued.map(({ supplierRequest }) => supplierRequest.id),
      );
      const request = await requestDetails(
        transaction,
        actor.tenantId,
        requestId,
      );
      return {
        request,
        links: issued.map(({ supplierRequest, token }) => ({
          supplierRequestId: supplierRequest.id,
          supplierId: supplierRequest.supplierId,
          businessName: supplierRequest.supplier.businessName,
          url: supplierShareUrl(baseUrl, token.raw),
          expiresAt: expiresAt.toISOString(),
        })),
      };
    },
    client,
  );
}

export async function changeSupplierRequestLink(
  input: {
    actor: RequestActor;
    requestId: string;
    supplierRequestId: unknown;
    expectedVersion: unknown;
    action: unknown;
  },
  client: RequestClient = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const requestId = validateRequestId(input.requestId);
  const action = validateLinkActionInput({
    action: input.action,
    supplierRequestId: input.supplierRequestId,
    expectedVersion: input.expectedVersion,
  });
  const serviceOptions = optionsWithDefaults(options);
  const baseUrl =
    action.action === 'rotate'
      ? shareBaseUrl(serviceOptions.shareBaseUrl)
      : undefined;

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const locked = await lockRequest(transaction, actor, requestId);
      assertVersionAndStatus(locked, action.expectedVersion, 'OPEN');
      const [lockedGrant] = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "SupplierRequest"
        WHERE "tenantId" = ${actor.tenantId}
          AND "requestId" = ${requestId}
          AND "id" = ${action.supplierRequestId}
        FOR UPDATE
      `;
      if (!lockedGrant) throw new ProcurementRequestNotFoundError();

      const currentGrant = await transaction.supplierRequest.findFirst({
        where: {
          tenantId: actor.tenantId,
          requestId,
          id: action.supplierRequestId,
        },
        select: safeSupplierRequestSelect,
      });
      if (!currentGrant) throw new ProcurementRequestNotFoundError();

      let rawLink:
        | { url: string; expiresAt: string }
        | undefined;
      if (action.action === 'revoke') {
        const now = await transactionTime(
          transaction,
          serviceOptions.transactionClock,
        );
        if (currentGrant.revokedAt) {
          throw new ProcurementRequestConflictError(
            'This supplier link is already revoked.',
          );
        }
        await transaction.supplierRequest.update({
          where: {
            tenantId_id: {
              tenantId: actor.tenantId,
              id: currentGrant.id,
            },
          },
          data: { revokedAt: now },
        });
        await writeAuditEvent(transaction, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'supplier-link.revoked',
          entityId: currentGrant.id,
        });
      } else {
        await activeSuppliers(transaction, actor.tenantId, [currentGrant.supplierId]);
        const now = await transactionTime(
          transaction,
          serviceOptions.transactionClock,
        );
        if (locked.quoteDeadline.getTime() <= now.getTime()) {
          throw new ProcurementRequestConflictError(
            'The quote deadline has passed; this link cannot be rotated.',
          );
        }
        const token = issueToken(serviceOptions.tokenFactory);
        const expiresAt = linkExpiry(now, locked.quoteDeadline);
        await transaction.supplierRequest.update({
          where: {
            tenantId_id: {
              tenantId: actor.tenantId,
              id: currentGrant.id,
            },
          },
          data: {
            tokenDigest: token.digest,
            expiresAt,
            revokedAt: null,
            viewedAt: null,
          },
        });
        await writeAuditEvent(transaction, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'supplier-link.created',
          entityId: currentGrant.id,
        });
        rawLink = {
          url: supplierShareUrl(baseUrl!, token.raw),
          expiresAt: expiresAt.toISOString(),
        };
      }

      await transaction.procurementRequest.update({
        where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
        data: { version: { increment: 1 } },
      });
      const request = await requestDetails(
        transaction,
        actor.tenantId,
        requestId,
      );
      const supplierRequest = request.supplierRequests.find(
        ({ id }) => id === currentGrant.id,
      );
      if (!supplierRequest) throw new ProcurementRequestNotFoundError();
      return {
        request,
        supplierRequest,
        ...(rawLink ? { link: rawLink } : {}),
      };
    },
    client,
  );
}

export async function repeatProcurementRequest(
  input: { actor: RequestActor; sourceRequestId: string; repeat: unknown },
  client: RequestClient = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const sourceRequestId = validateRequestId(input.sourceRequestId);
  const serviceOptions = optionsWithDefaults(options);
  const repeat = validateRepeatRequestInput(input.repeat, serviceOptions.now());

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const locked = await lockRequest(transaction, actor, sourceRequestId);
      if (locked.version !== repeat.expectedSourceVersion) {
        throw new ProcurementRequestConflictError(
          'This request changed. Refresh it before running it again.',
        );
      }
      if (locked.status !== 'AWARDED') {
        throw new ProcurementRequestConflictError(
          'Only a completed award can be run again.',
        );
      }
      const now = await transactionTime(transaction, serviceOptions.transactionClock);
      if (repeat.quoteDeadline.getTime() <= now.getTime()) {
        throw new ProcurementRequestValidationError({
          quoteDeadline: ['Quote deadline must be in the future.'],
        });
      }
      const source = await transaction.procurementRequest.findFirst({
        where: { tenantId: actor.tenantId, id: sourceRequestId },
        select: {
          id: true,
          menuId: true,
          deliveryDetails: true,
          commercialTerms: true,
          items: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              name: true,
              quantity: true,
              unit: true,
            },
          },
          supplierRequests: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            where: { supplier: { isActive: true } },
            select: { supplierId: true },
          },
        },
      });
      if (!source || source.items.length === 0 || !isRecord(source.deliveryDetails)) {
        throw new ProcurementRequestNotFoundError();
      }
      if (source.supplierRequests.length === 0) {
        throw new ProcurementRequestConflictError(
          'Reactivate or add a supplier before running this request again.',
        );
      }
      const expiresAt = linkExpiry(now, repeat.quoteDeadline);
      const grants = source.supplierRequests.map(({ supplierId }) => ({
        supplierId,
        token: issueToken(serviceOptions.tokenFactory),
      }));
      const created = await transaction.procurementRequest.create({
        data: {
          tenantId: actor.tenantId,
          title: repeat.title,
          status: 'DRAFT',
          version: 1,
          menuId: source.menuId,
          sourceRequestId: source.id,
          deliveryDetails: source.deliveryDetails as Prisma.InputJsonObject,
          deliveryDate: repeat.deliveryDate,
          quoteDeadline: repeat.quoteDeadline,
          commercialTerms: source.commercialTerms,
          createdByUserId: actor.userId,
          items: {
            create: source.items.map((item) => ({
              tenantId: actor.tenantId,
              name: item.name,
              quantity: item.quantity,
              unit: item.unit,
            })),
          },
          supplierRequests: {
            create: grants.map(({ supplierId, token }) => ({
              tenantId: actor.tenantId,
              supplierId,
              tokenDigest: token.digest,
              expiresAt,
            })),
          },
        },
        include: requestDetailInclude,
      });
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'request.repeated',
        entityId: created.id,
        metadata: { sourceRequestId: source.id },
      });
      return created;
    },
    client,
  );
}
