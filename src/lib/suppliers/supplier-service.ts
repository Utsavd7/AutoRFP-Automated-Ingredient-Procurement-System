import { randomUUID } from 'node:crypto';

import {
  Prisma,
  type SupplierRelationshipType,
  type SupplierVerificationStatus,
  type UserRole,
} from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';
import {
  EMPTY_QUOTE_REVISIONS,
  fragmentShareUrl,
  issueToken,
  linkExpiry,
  shareBaseUrl,
  type IssuedToken,
} from '@/lib/procurement/request-service';
import {
  requestAcceptsVerifiedApplications,
  RequestDocumentValidationError,
  validateRequestDocuments,
} from '@/lib/procurement/request-document';
import { createOpaqueToken } from '@/lib/security/tokens';
import {
  type ParsedSupplierCsvRow,
  SUPPLIER_CSV_LIMITS,
  SupplierCsvError,
  type SupplierCsvRowError,
} from '@/lib/suppliers/csv';
import {
  type SupplierCapabilitiesV1,
  SupplierCapabilitiesValidationError,
  validateSupplierCapabilities,
} from '@/lib/suppliers/supplier-capabilities';
import {
  SUPPLIER_LIMITS,
  SupplierValidationError,
  validateSupplierLifecycleState,
  validateSupplierCreateInput,
  validateSupplierListInput,
  validateSupplierUpdateInput,
  validateSupplierVerificationDecision,
} from '@/lib/suppliers/supplier-schema';

type SupplierActor = { tenantId: string; userId: string };

type SupplierVerificationOptions = {
  tokenFactory?: () => IssuedToken;
  shareBaseUrl?: string;
};

type SupplierFilters = { active: boolean | null; search: string | null };

type SupplierCursor = SupplierFilters & {
  v: 1;
  snapshot: string;
  createdAt: string;
  id: string;
};

const SUPPLIER_ID_BYTES = 200;
const SUPPLIER_CURSOR_VERSION = 1;
export const SUPPLIER_EXPORT_LIMIT = 500;

const supplierSummarySelect = {
  id: true,
  tenantId: true,
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
  notes: true,
  relationshipType: true,
  verificationStatus: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierSelect;

const supplierDetailSelect = {
  ...supplierSummarySelect,
  applicationRequestId: true,
  capabilities: true,
  verifiedAt: true,
  verifiedByUserId: true,
} satisfies Prisma.SupplierSelect;

const supplierExportSelect = {
  ...supplierSummarySelect,
  capabilities: true,
} satisfies Prisma.SupplierSelect;

export class SupplierConflictError extends Error {
  readonly code = 'SUPPLIER_CONFLICT';
  readonly status = 409;

  constructor(readonly errors: Record<string, string[]>) {
    super('A supplier with this email or phone already exists.');
    this.name = 'SupplierConflictError';
  }
}

export class SupplierNotFoundError extends Error {
  readonly code = 'SUPPLIER_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Supplier not found.');
    this.name = 'SupplierNotFoundError';
  }
}

export class SupplierVerificationConflictError extends Error {
  readonly code = 'SUPPLIER_VERIFICATION_CONFLICT';
  readonly status = 409;

  constructor() {
    super('This supplier application has already been decided or cannot be changed here.');
    this.name = 'SupplierVerificationConflictError';
  }
}

function validId(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= SUPPLIER_ID_BYTES &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validateActor(actor: SupplierActor) {
  if (!validId(actor.tenantId) || !validId(actor.userId)) {
    throw new AuthorizationError();
  }
  return actor;
}

function validateSupplierId(value: string) {
  if (!validId(value)) throw new SupplierNotFoundError();
  return value;
}

async function requireActiveActor(
  transaction: Prisma.TransactionClient,
  actor: SupplierActor,
) {
  const current = await transaction.user.findFirst({
    where: {
      id: actor.userId,
      tenantId: actor.tenantId,
      isActive: true,
      accountState: 'ACTIVE',
      tenant: { isActive: true },
    },
    select: { id: true, role: true },
  });
  if (!current) throw new AuthorizationError();
  return current;
}

function prismaCapabilities(
  capabilities: SupplierCapabilitiesV1,
): Prisma.InputJsonValue {
  return capabilities as unknown as Prisma.InputJsonValue;
}

function storedCapabilities(value: Prisma.JsonValue): SupplierCapabilitiesV1 {
  try {
    return validateSupplierCapabilities(value);
  } catch (error) {
    if (!(error instanceof SupplierCapabilitiesValidationError)) throw error;
    throw new SupplierValidationError({
      capabilities: [`Stored supplier capabilities are invalid: ${error.message}`],
    });
  }
}

function validatedDetail<T extends { capabilities: Prisma.JsonValue }>(supplier: T) {
  return { ...supplier, capabilities: storedCapabilities(supplier.capabilities) };
}

async function lockTenant(
  transaction: Prisma.TransactionClient,
  tenantId: string,
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Tenant"
    WHERE "id" = ${tenantId}
    FOR UPDATE
  `;
  if (!rows[0]) throw new AuthorizationError();
}

async function duplicateErrors(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    email?: string | null;
    phone?: string | null;
    excludeSupplierId?: string;
  },
) {
  const contacts: Prisma.SupplierWhereInput[] = [];
  if (input.email) {
    contacts.push({ email: { equals: input.email, mode: 'insensitive' } });
  }
  if (input.phone) contacts.push({ phone: input.phone });
  if (contacts.length === 0) return {};

  const matches = await transaction.supplier.findMany({
    where: {
      tenantId: input.tenantId,
      ...(input.excludeSupplierId ? { id: { not: input.excludeSupplierId } } : {}),
      OR: contacts,
    },
    select: { email: true, phone: true },
  });
  const errors: Record<string, string[]> = {};
  if (
    input.email &&
    matches.some(({ email }) => email?.toLowerCase() === input.email!.toLowerCase())
  ) {
    errors.email = ['Email already belongs to another supplier.'];
  }
  if (input.phone && matches.some(({ phone }) => phone === input.phone)) {
    errors.phone = ['Phone already belongs to another supplier.'];
  }
  return errors;
}

function encodeCursor(cursor: SupplierCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function invalidCursor(message = 'Cursor is invalid or expired.'): never {
  throw new SupplierValidationError({ cursor: [message] });
}

function normalizedFilters(input: {
  active: boolean | null;
  search: string | undefined;
}): SupplierFilters {
  return {
    active: input.active,
    search: input.search?.toLowerCase() ?? null,
  };
}

function decodeCursor(
  cursor: string | undefined,
  filters: SupplierFilters,
): SupplierCursor | undefined {
  if (!cursor) return undefined;
  let value: SupplierCursor;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Invalid cursor');
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(',') !==
        'active,createdAt,id,search,snapshot,v'
    ) {
      throw new Error('Invalid cursor');
    }
    value = parsed as SupplierCursor;
    const snapshot = new Date(value.snapshot);
    const createdAt = new Date(value.createdAt);
    const validSearch =
      value.search === null ||
      (typeof value.search === 'string' &&
        value.search.length > 0 &&
        value.search === value.search.trim() &&
        value.search === value.search.toLowerCase() &&
        Buffer.byteLength(value.search, 'utf8') <= SUPPLIER_LIMITS.searchBytes &&
        !/[\u0000-\u001f\u007f]/.test(value.search));
    if (
      value.v !== SUPPLIER_CURSOR_VERSION ||
      (value.active !== null && typeof value.active !== 'boolean') ||
      !validSearch ||
      typeof value.snapshot !== 'string' ||
      Number.isNaN(snapshot.getTime()) ||
      snapshot.toISOString() !== value.snapshot ||
      typeof value.createdAt !== 'string' ||
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== value.createdAt ||
      createdAt.getTime() > snapshot.getTime() ||
      !validId(value.id) ||
      /[\u0000-\u001f\u007f]/.test(value.createdAt)
    ) {
      throw new Error('Invalid cursor');
    }
  } catch {
    return invalidCursor();
  }
  if (value.active !== filters.active || value.search !== filters.search) {
    return invalidCursor('Cursor does not match these supplier filters.');
  }
  return value;
}

function listWhere(input: {
  tenantId: string;
  active: boolean | null;
  search: string | null;
  cursor: SupplierCursor | undefined;
  snapshot: Date;
}): Prisma.SupplierWhereInput {
  const and: Prisma.SupplierWhereInput[] = [];
  if (input.search) {
    and.push({
      OR: [
        { businessName: { contains: input.search, mode: 'insensitive' } },
        { contactName: { contains: input.search, mode: 'insensitive' } },
        { email: { contains: input.search, mode: 'insensitive' } },
        { phone: { contains: input.search } },
        { city: { contains: input.search, mode: 'insensitive' } },
        { gstin: { contains: input.search, mode: 'insensitive' } },
      ],
    });
  }
  if (input.cursor) {
    const cursorCreatedAt = new Date(input.cursor.createdAt);
    and.push({
      OR: [
        { createdAt: { gt: cursorCreatedAt } },
        {
          createdAt: cursorCreatedAt,
          id: { gt: input.cursor.id },
        },
      ],
    });
  }
  return {
    tenantId: input.tenantId,
    createdAt: { lte: input.snapshot },
    ...(input.active === null ? {} : { isActive: input.active }),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

type SupplierPageInput = {
  tenantId: string;
  active: boolean | null;
  search: string | null;
  cursor: SupplierCursor | undefined;
  snapshot: Date;
  limit: number;
};

async function findSupplierPage(
  transaction: Prisma.TransactionClient,
  input: SupplierPageInput,
) {
  const suppliers = await transaction.supplier.findMany({
    where: listWhere(input),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: input.limit + 1,
    select: supplierSummarySelect,
  });
  const hasMore = suppliers.length > input.limit;
  if (hasMore) suppliers.pop();
  const last = suppliers.at(-1);
  return {
    suppliers,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            v: SUPPLIER_CURSOR_VERSION,
            snapshot: input.snapshot.toISOString(),
            active: input.active,
            search: input.search,
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null,
  };
}

async function findSupplierExportPage(
  transaction: Prisma.TransactionClient,
  input: SupplierPageInput,
) {
  const suppliers = await transaction.supplier.findMany({
    where: {
      AND: [
        listWhere(input),
        {
          relationshipType: { in: ['CURRENT', 'SELECTED_NEW'] },
          verificationStatus: 'VERIFIED',
        },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: input.limit + 1,
    select: supplierExportSelect,
  });
  const hasMore = suppliers.length > input.limit;
  if (hasMore) suppliers.pop();
  const validated = suppliers.map((supplier) => {
    if (
      supplier.relationshipType === 'APPLICANT' ||
      supplier.verificationStatus !== 'VERIFIED'
    ) {
      throw new SupplierVerificationConflictError();
    }
    return {
      ...validatedDetail(supplier),
      relationshipType: supplier.relationshipType,
    };
  });
  const last = validated.at(-1);
  return {
    suppliers: validated,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            v: SUPPLIER_CURSOR_VERSION,
            snapshot: input.snapshot.toISOString(),
            active: input.active,
            search: input.search,
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null,
  };
}

async function transactionSnapshot(transaction: Prisma.TransactionClient) {
  const rows = await transaction.$queryRaw<Array<{ snapshot: Date }>>`
    SELECT transaction_timestamp() AS "snapshot"
  `;
  const snapshot = rows[0]?.snapshot;
  if (!(snapshot instanceof Date) || Number.isNaN(snapshot.getTime())) {
    throw new Error('Database transaction timestamp is unavailable.');
  }
  return snapshot;
}

async function databaseClock(transaction: Prisma.TransactionClient) {
  const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT pg_catalog.clock_timestamp() AS "now"
  `;
  if (!clock || !(clock.now instanceof Date) || Number.isNaN(clock.now.getTime())) {
    throw new TypeError('PostgreSQL returned an invalid supplier review clock.');
  }
  return clock.now;
}

export async function createSupplier(
  input: { actor: SupplierActor; supplier: unknown },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  const supplier = validateSupplierCreateInput(input.supplier);
  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await lockTenant(transaction, actor.tenantId);
      await requireActiveActor(transaction, actor);
      const conflicts = await duplicateErrors(transaction, {
        tenantId: actor.tenantId,
        email: supplier.email,
        phone: supplier.phone,
      });
      if (Object.keys(conflicts).length > 0) {
        throw new SupplierConflictError(conflicts);
      }
      const verifiedAt = await databaseClock(transaction);
      validateSupplierLifecycleState({
        relationshipType: supplier.relationshipType,
        verificationStatus: 'VERIFIED',
        applicationRequestId: null,
        verifiedAt,
        verifiedByUserId: actor.userId,
        isActive: supplier.isActive,
      });
      const { capabilities, ...fields } = supplier;
      const created = await transaction.supplier.create({
        data: {
          tenantId: actor.tenantId,
          ...fields,
          verificationStatus: 'VERIFIED',
          applicationRequestId: null,
          capabilities: prismaCapabilities(capabilities),
          verifiedAt,
          verifiedByUserId: actor.userId,
        },
        select: supplierDetailSelect,
      });
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'supplier.created',
        entityId: created.id,
      });
      return validatedDetail(created);
    },
    client,
  );
}

export async function listSuppliers(
  input: {
    actor: SupplierActor;
    active?: unknown;
    search?: unknown;
    cursor?: unknown;
    limit?: unknown;
  },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  const query = validateSupplierListInput({
    active: input.active,
    search: input.search,
    cursor: input.cursor,
    limit: input.limit,
  });
  const filters = normalizedFilters(query);
  const cursor = decodeCursor(query.cursor, filters);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const snapshot = cursor
        ? new Date(cursor.snapshot)
        : await transactionSnapshot(transaction);
      return findSupplierPage(transaction, {
        tenantId: actor.tenantId,
        ...filters,
        cursor,
        snapshot,
        limit: query.limit,
      });
    },
    client,
  );
}

export async function listSuppliersForExport(
  input: {
    actor: SupplierActor;
    active?: unknown;
    search?: unknown;
    cursor?: unknown;
    limit?: unknown;
  },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  const boundedList = validateSupplierListInput({
    active: input.active,
    search: input.search,
    cursor: input.cursor,
    limit: 1,
  });
  const limit = input.limit === undefined ? SUPPLIER_EXPORT_LIMIT : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SUPPLIER_EXPORT_LIMIT) {
    throw new SupplierValidationError({
      limit: [`Export limit must be between 1 and ${SUPPLIER_EXPORT_LIMIT}.`],
    });
  }
  const filters = normalizedFilters(boundedList);
  const cursor = decodeCursor(boundedList.cursor, filters);
  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const snapshot = cursor
        ? new Date(cursor.snapshot)
        : await transactionSnapshot(transaction);
      return findSupplierExportPage(transaction, {
        tenantId: actor.tenantId,
        ...filters,
        cursor,
        snapshot,
        limit,
      });
    },
    client,
  );
}

export async function getSupplier(
  input: { actor: SupplierActor; supplierId: string },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  const supplierId = validateSupplierId(input.supplierId);
  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      const supplier = await transaction.supplier.findFirst({
        where: { tenantId: actor.tenantId, id: supplierId },
        select: supplierDetailSelect,
      });
      if (!supplier) throw new SupplierNotFoundError();
      return validatedDetail(supplier);
    },
    client,
  );
}

export async function updateSupplier(
  input: { actor: SupplierActor; supplierId: string; changes: unknown },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  const supplierId = validateSupplierId(input.supplierId);
  const changes = validateSupplierUpdateInput(input.changes);
  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await lockTenant(transaction, actor.tenantId);
      await requireActiveActor(transaction, actor);
      const existing = await transaction.supplier.findFirst({
        where: { tenantId: actor.tenantId, id: supplierId },
        select: {
          relationshipType: true,
          verificationStatus: true,
          applicationRequestId: true,
          verifiedAt: true,
          verifiedByUserId: true,
          isActive: true,
        },
      });
      if (!existing) throw new SupplierNotFoundError();
      if (
        existing.relationshipType === 'APPLICANT' &&
        (existing.verificationStatus === 'PENDING' ||
          existing.verificationStatus === 'REJECTED')
      ) {
        throw new SupplierVerificationConflictError();
      }
      validateSupplierLifecycleState({
        ...existing,
        relationshipType: changes.relationshipType ?? existing.relationshipType,
        isActive: changes.isActive ?? existing.isActive,
      });
      const conflicts = await duplicateErrors(transaction, {
        tenantId: actor.tenantId,
        email: changes.email,
        phone: changes.phone,
        excludeSupplierId: supplierId,
      });
      if (Object.keys(conflicts).length > 0) {
        throw new SupplierConflictError(conflicts);
      }
      let revokedAt: Date | undefined;
      if (changes.isActive === false) {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "SupplierRequest"
          WHERE "tenantId" = ${actor.tenantId}
            AND "supplierId" = ${supplierId}
          ORDER BY "id"
          FOR UPDATE
        `;
        revokedAt = await databaseClock(transaction);
      }
      const { capabilities, ...scalarChanges } = changes;
      const updated = await transaction.supplier.update({
        where: {
          tenantId_id: { tenantId: actor.tenantId, id: supplierId },
        },
        data: {
          ...scalarChanges,
          ...(capabilities
            ? { capabilities: prismaCapabilities(capabilities) }
            : {}),
        },
        select: supplierDetailSelect,
      });
      if (revokedAt) {
        await transaction.supplierRequest.updateMany({
          where: {
            tenantId: actor.tenantId,
            supplierId,
            revokedAt: null,
          },
          data: { revokedAt },
        });
      }
      return validatedDetail(updated);
    },
    client,
  );
}

export async function deactivateSupplier(
  input: { actor: SupplierActor; supplierId: string },
  client: TenantTransactionHost = prisma,
) {
  return updateSupplier(
    { ...input, changes: { isActive: false } },
    client,
  );
}

function importValidation(rows: ParsedSupplierCsvRow[]) {
  const errors: SupplierCsvRowError[] = [];
  let errorCount = 0;
  const valid: ParsedSupplierCsvRow[] = [];
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const push = (error: SupplierCsvRowError) => {
    errorCount += 1;
    if (errors.length < SUPPLIER_CSV_LIMITS.errorReport) errors.push(error);
  };

  if (!Array.isArray(rows) || rows.length === 0 || rows.length > SUPPLIER_CSV_LIMITS.rows) {
    throw new SupplierCsvError(
      rows.length > SUPPLIER_CSV_LIMITS.rows ? 'CSV_ROW_LIMIT' : 'CSV_INVALID_ROWS',
      422,
      [],
      0,
    );
  }
  for (const item of rows) {
    if (!Number.isSafeInteger(item?.row) || item.row < 2) {
      push({
        row: 2,
        field: 'csv',
        code: 'invalid',
        message: 'CSV row number is invalid.',
      });
      continue;
    }
    try {
      const supplier = validateSupplierCreateInput(item.supplier);
      if (supplier.email && seenEmails.has(supplier.email)) {
        push({
          row: item.row,
          field: 'email',
          code: 'duplicate',
          message: 'Email is repeated in this file.',
        });
      }
      if (supplier.phone && seenPhones.has(supplier.phone)) {
        push({
          row: item.row,
          field: 'phone',
          code: 'duplicate',
          message: 'Phone is repeated in this file.',
        });
      }
      if (supplier.email) seenEmails.add(supplier.email);
      if (supplier.phone) seenPhones.add(supplier.phone);
      valid.push({ row: item.row, supplier });
    } catch (error) {
      if (!(error instanceof SupplierValidationError)) throw error;
      for (const [field, messages] of Object.entries(error.errors)) {
        for (const message of messages) {
          push({ row: item.row, field, code: 'invalid', message });
        }
      }
    }
  }
  if (errorCount > 0) {
    throw new SupplierCsvError('CSV_INVALID_ROWS', 422, errors, errorCount);
  }
  return valid;
}

function conflictReport(
  rows: ParsedSupplierCsvRow[],
  existing: Array<{ email: string | null; phone: string | null }>,
) {
  const emails = new Set(
    existing.flatMap(({ email }) => (email ? [email.toLowerCase()] : [])),
  );
  const phones = new Set(existing.flatMap(({ phone }) => (phone ? [phone] : [])));
  const errors: SupplierCsvRowError[] = [];
  let errorCount = 0;
  for (const { row, supplier } of rows) {
    if (supplier.email && emails.has(supplier.email)) {
      errorCount += 1;
      if (errors.length < SUPPLIER_CSV_LIMITS.errorReport) {
        errors.push({
          row,
          field: 'email',
          code: 'duplicate',
          message: 'Email already belongs to another supplier.',
        });
      }
    }
    if (supplier.phone && phones.has(supplier.phone)) {
      errorCount += 1;
      if (errors.length < SUPPLIER_CSV_LIMITS.errorReport) {
        errors.push({
          row,
          field: 'phone',
          code: 'duplicate',
          message: 'Phone already belongs to another supplier.',
        });
      }
    }
  }
  return { errors, errorCount };
}

export async function importSupplierRows(
  input: { actor: SupplierActor; rows: ParsedSupplierCsvRow[] },
  client: TenantTransactionHost = prisma,
): Promise<{ importedCount: number }> {
  const actor = validateActor(input.actor);
  const rows = importValidation(input.rows);
  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await lockTenant(transaction, actor.tenantId);
      await requireActiveActor(transaction, actor);
      const verifiedAt = await databaseClock(transaction);
      const emails = rows.flatMap(({ supplier }) =>
        supplier.email ? [supplier.email] : [],
      );
      const phones = rows.flatMap(({ supplier }) =>
        supplier.phone ? [supplier.phone] : [],
      );
      const existing = await transaction.supplier.findMany({
        where: {
          tenantId: actor.tenantId,
          OR: [
            ...(emails.length > 0
              ? [{ email: { in: emails, mode: 'insensitive' as const } }]
              : []),
            ...(phones.length > 0 ? [{ phone: { in: phones } }] : []),
          ],
        },
        select: { email: true, phone: true },
      });
      const conflicts = conflictReport(rows, existing);
      if (conflicts.errorCount > 0) {
        throw new SupplierCsvError(
          'CSV_CONFLICT',
          422,
          conflicts.errors,
          conflicts.errorCount,
        );
      }

      const suppliers = rows.map(({ supplier }) => ({
        id: randomUUID(),
        tenantId: actor.tenantId,
        businessName: supplier.businessName,
        contactName: supplier.contactName,
        phone: supplier.phone,
        whatsappNumber: supplier.whatsappNumber,
        email: supplier.email,
        addressLine: supplier.addressLine,
        city: supplier.city,
        state: supplier.state,
        pin: supplier.pin,
        gstin: supplier.gstin,
        notes: supplier.notes,
        isActive: supplier.isActive,
        relationshipType: supplier.relationshipType,
        verificationStatus: 'VERIFIED' as const,
        applicationRequestId: null,
        capabilities: prismaCapabilities(supplier.capabilities),
        verifiedAt,
        verifiedByUserId: actor.userId,
      }));
      const result = await transaction.supplier.createMany({ data: suppliers });
      await transaction.auditEvent.createMany({
        data: suppliers.map(({ id }) => ({
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'supplier.created',
          entityType: 'Supplier',
          entityId: id,
        })),
      });
      return { importedCount: result.count };
    },
    client,
  );
}

type LockedSupplierApplication = {
  id: string;
  relationshipType: SupplierRelationshipType;
  verificationStatus: SupplierVerificationStatus;
  applicationRequestId: string | null;
  isActive: boolean;
  verifiedAt: Date | null;
  verifiedByUserId: string | null;
};

type LockedApplicationRequest = {
  id: string;
  status: string;
  items: Prisma.JsonValue;
  sourcing: Prisma.JsonValue;
  quoteDeadline: Date;
  applicationTokenDigest: string | null;
  applicationExpiresAt: Date | null;
  applicationRevokedAt: Date | null;
  now: Date;
};

const approvedSupplierRequestSelect = {
  id: true,
  tenantId: true,
  requestId: true,
  supplierId: true,
  expiresAt: true,
  revokedAt: true,
  viewedAt: true,
  quoteRevision: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierRequestSelect;

function requestAcceptsApproval(request: LockedApplicationRequest) {
  if (
    request.status !== 'OPEN' ||
    !/^[a-f0-9]{64}$/.test(request.applicationTokenDigest ?? '') ||
    request.applicationRevokedAt !== null ||
    !(request.applicationExpiresAt instanceof Date) ||
    !(request.quoteDeadline instanceof Date) ||
    !(request.now instanceof Date) ||
    Number.isNaN(request.applicationExpiresAt.getTime()) ||
    Number.isNaN(request.quoteDeadline.getTime()) ||
    Number.isNaN(request.now.getTime()) ||
    request.applicationExpiresAt.getTime() <= request.now.getTime() ||
    request.quoteDeadline.getTime() <= request.now.getTime()
  ) {
    return false;
  }
  try {
    const documents = validateRequestDocuments(request.items, request.sourcing);
    return requestAcceptsVerifiedApplications(
      documents.items,
      documents.sourcing,
    );
  } catch (error) {
    if (error instanceof RequestDocumentValidationError) return false;
    throw error;
  }
}

export async function decideSupplierVerification(
  input: {
    actor: SupplierActor;
    supplierId: string;
    decision: unknown;
  },
  client: TenantTransactionHost = prisma,
  options: SupplierVerificationOptions = {},
) {
  const actor = validateActor(input.actor);
  const supplierId = validateSupplierId(input.supplierId);
  const decision = validateSupplierVerificationDecision({ decision: input.decision });
  return withTenant(
    actor.tenantId,
    async (transaction) => {
      const current = await requireActiveActor(transaction, actor);
      if ((current.role as UserRole) !== 'OWNER') throw new AuthorizationError();

      const candidate = await transaction.supplier.findFirst({
        where: { tenantId: actor.tenantId, id: supplierId },
        select: { applicationRequestId: true },
      });
      if (!candidate) throw new SupplierNotFoundError();
      if (!candidate.applicationRequestId) {
        throw new SupplierVerificationConflictError();
      }

      const [request] = await transaction.$queryRaw<LockedApplicationRequest[]>`
        SELECT "id", "status", "items", "sourcing", "quoteDeadline",
               "applicationTokenDigest", "applicationExpiresAt",
               "applicationRevokedAt", pg_catalog.clock_timestamp() AS "now"
        FROM "ProcurementRequest"
        WHERE "tenantId" = ${actor.tenantId}
          AND "id" = ${candidate.applicationRequestId}
        FOR UPDATE
      `;
      if (!request) throw new SupplierVerificationConflictError();

      const [supplier] = await transaction.$queryRaw<LockedSupplierApplication[]>`
        SELECT "id", "relationshipType", "verificationStatus",
               "applicationRequestId", "isActive", "verifiedAt", "verifiedByUserId"
        FROM "Supplier"
        WHERE "tenantId" = ${actor.tenantId}
          AND "id" = ${supplierId}
        FOR UPDATE
      `;
      if (!supplier) throw new SupplierNotFoundError();
      if (
        supplier.relationshipType !== 'APPLICANT' ||
        supplier.verificationStatus !== 'PENDING' ||
        supplier.isActive ||
        !supplier.applicationRequestId ||
        supplier.applicationRequestId !== candidate.applicationRequestId ||
        supplier.verifiedAt !== null ||
        supplier.verifiedByUserId !== null
      ) {
        throw new SupplierVerificationConflictError();
      }

      const existingSupplierRequests = await transaction.$queryRaw<
        Array<{ id: string }>
      >`
        SELECT "id"
        FROM "SupplierRequest"
        WHERE "tenantId" = ${actor.tenantId}
          AND "requestId" = ${request.id}
          AND "supplierId" = ${supplierId}
        ORDER BY "id"
        FOR UPDATE
      `;
      if (existingSupplierRequests.length > 0) {
        throw new SupplierVerificationConflictError();
      }

      if (decision === 'APPROVE' && !requestAcceptsApproval(request)) {
        throw new SupplierVerificationConflictError();
      }

      const lifecycle = validateSupplierLifecycleState(decision === 'APPROVE'
        ? {
            relationshipType: 'SELECTED_NEW',
            verificationStatus: 'VERIFIED',
            applicationRequestId: supplier.applicationRequestId,
            verifiedAt: request.now,
            verifiedByUserId: actor.userId,
            isActive: true,
          }
        : {
            relationshipType: 'APPLICANT',
            verificationStatus: 'REJECTED',
            applicationRequestId: supplier.applicationRequestId,
            verifiedAt: null,
            verifiedByUserId: null,
            isActive: false,
          });

      let supplierRequest: Prisma.SupplierRequestGetPayload<{
        select: typeof approvedSupplierRequestSelect;
      }> | undefined;
      let link: { url: string; expiresAt: string } | undefined;
      if (decision === 'APPROVE') {
        const token = issueToken(
          'supplier-request',
          options.tokenFactory ?? (() => createOpaqueToken('supplier-request')),
        );
        const expiresAt = linkExpiry(request.now, request.quoteDeadline);
        const baseUrl = shareBaseUrl(options.shareBaseUrl);
        supplierRequest = await transaction.supplierRequest.create({
          data: {
            tenantId: actor.tenantId,
            requestId: request.id,
            supplierId,
            tokenDigest: token.digest,
            expiresAt,
            revokedAt: null,
            viewedAt: null,
            quoteRevision: 0,
            quoteRevisions:
              EMPTY_QUOTE_REVISIONS as unknown as Prisma.InputJsonValue,
          },
          select: approvedSupplierRequestSelect,
        });
        link = {
          url: fragmentShareUrl(baseUrl, '/quote', token.raw),
          expiresAt: expiresAt.toISOString(),
        };
      }

      const updated = await transaction.supplier.updateMany({
        where: {
          tenantId: actor.tenantId,
          id: supplierId,
          relationshipType: 'APPLICANT',
          verificationStatus: 'PENDING',
          isActive: false,
        },
        data: lifecycle,
      });
      if (updated.count !== 1) throw new SupplierVerificationConflictError();
      const reviewed = await transaction.supplier.findFirst({
        where: { tenantId: actor.tenantId, id: supplierId },
        select: supplierDetailSelect,
      });
      if (!reviewed) throw new SupplierNotFoundError();
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: decision === 'APPROVE' ? 'supplier.verified' : 'supplier.rejected',
        entityId: supplierId,
      });
      if (supplierRequest) {
        await writeAuditEvent(transaction, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'supplier-link.created',
          entityId: supplierRequest.id,
        });
      }
      return {
        supplier: validatedDetail(reviewed),
        ...(supplierRequest && link ? { supplierRequest, link } : {}),
      };
    },
    client,
  );
}
