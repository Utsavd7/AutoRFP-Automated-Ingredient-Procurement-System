import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import {
  PROCUREMENT_CATEGORIES,
  type ProcurementCategory,
} from '@/lib/domain/procurement-categories';
import { prisma } from '@/lib/prisma';
import {
  requestAcceptsVerifiedApplications,
  RequestDocumentValidationError,
  validateRequestDocuments,
} from '@/lib/procurement/request-document';
import { exchangeSupplierApplicationGrantToken } from '@/lib/security/public-grant';
import { digestOpaqueToken } from '@/lib/security/tokens';
import {
  supplierCapabilitiesForCategories,
  type SupplierCapabilitiesV1,
} from '@/lib/suppliers/supplier-capabilities';
import {
  SupplierValidationError,
  validateSupplierCreateInput,
  validateSupplierLifecycleState,
} from '@/lib/suppliers/supplier-schema';

export const PUBLIC_SUPPLIER_APPLICATION_PENDING_CAP = 25;
export const PUBLIC_SUPPLIER_APPLICATION_UNAVAILABLE_MESSAGE =
  'This supplier application link is invalid or no longer available.';

type PublicApplicationClient = Pick<PrismaClient, '$queryRaw' | '$transaction'> &
  TenantTransactionHost;

type PublicApplicationOptions = {
  exchange?: typeof exchangeSupplierApplicationGrantToken;
  idFactory?: () => string;
};

type ValidPublicSupplierApplication = {
  token: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  categories: ProcurementCategory[];
  capabilities: SupplierCapabilitiesV1;
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

const INPUT_KEYS = new Set([
  'token',
  'businessName',
  'contactName',
  'phone',
  'whatsappNumber',
  'email',
  'categories',
]);

export class PublicSupplierApplicationValidationError extends Error {
  readonly code = 'INVALID_SUPPLIER_APPLICATION';
  readonly status = 422;

  constructor(readonly errors: Record<string, string[]>) {
    super('The supplier application contains invalid or unbounded fields.');
    this.name = 'PublicSupplierApplicationValidationError';
  }
}

export class PublicSupplierApplicationUnavailableError extends Error {
  readonly code = 'APPLICATION_UNAVAILABLE';
  readonly status = 410;

  constructor() {
    super(PUBLIC_SUPPLIER_APPLICATION_UNAVAILABLE_MESSAGE);
    this.name = 'PublicSupplierApplicationUnavailableError';
  }
}

function unavailable(): never {
  throw new PublicSupplierApplicationUnavailableError();
}

function plainApplication(input: unknown) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new PublicSupplierApplicationValidationError({
      body: ['Expected a JSON object.'],
    });
  }
  const errors = Object.create(null) as Record<string, string[]>;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !INPUT_KEYS.has(key)) {
      errors[String(key)] = ['This application field is not allowed.'];
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      errors[key] = ['Application fields must be enumerable data properties.'];
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new PublicSupplierApplicationValidationError(errors);
  }
  return input as Record<string, unknown>;
}

function validCategories(value: unknown): ProcurementCategory[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length === 0 ||
    value.length > Object.keys(PROCUREMENT_CATEGORIES).length
  ) {
    throw new PublicSupplierApplicationValidationError({
      categories: ['Choose at least one supported category.'],
    });
  }
  const categories: ProcurementCategory[] = [];
  for (const category of value) {
    if (
      typeof category !== 'string' ||
      !Object.prototype.hasOwnProperty.call(PROCUREMENT_CATEGORIES, category)
    ) {
      throw new PublicSupplierApplicationValidationError({
        categories: ['Choose only supported category keys.'],
      });
    }
    categories.push(category as ProcurementCategory);
  }
  if (new Set(categories).size !== categories.length) {
    throw new PublicSupplierApplicationValidationError({
      categories: ['Choose each category only once.'],
    });
  }
  return categories;
}

export function validatePublicSupplierApplicationInput(
  input: unknown,
): ValidPublicSupplierApplication {
  const application = plainApplication(input);
  if (typeof application.token !== 'string') unavailable();
  try {
    digestOpaqueToken('supplier-application', application.token);
  } catch {
    unavailable();
  }

  const categories = validCategories(application.categories);
  const supplierInput: Record<string, unknown> = {
    businessName: application.businessName,
  };
  for (const field of [
    'contactName',
    'phone',
    'whatsappNumber',
    'email',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(application, field)) {
      supplierInput[field] = application[field];
    }
  }

  let supplier: ReturnType<typeof validateSupplierCreateInput>;
  try {
    supplier = validateSupplierCreateInput(supplierInput);
  } catch (error) {
    if (!(error instanceof SupplierValidationError)) throw error;
    throw new PublicSupplierApplicationValidationError(error.errors);
  }
  if (!supplier.phone && !supplier.whatsappNumber && !supplier.email) {
    throw new PublicSupplierApplicationValidationError({
      contact: ['Provide a phone, WhatsApp number, or email address.'],
    });
  }
  const capabilities = supplierCapabilitiesForCategories(categories, 'BACKUP');
  return {
    token: application.token,
    businessName: supplier.businessName,
    contactName: supplier.contactName,
    phone: supplier.phone,
    whatsappNumber: supplier.whatsappNumber,
    email: supplier.email,
    categories: capabilities.categories.map(({ category }) => category),
    capabilities,
  };
}

async function lockTenant(
  transaction: Prisma.TransactionClient,
  tenantId: string,
) {
  const [tenant] = await transaction.$queryRaw<
    Array<{ id: string; isActive: boolean }>
  >`
    SELECT "id", "isActive"
    FROM "Tenant"
    WHERE "id" = ${tenantId}
    FOR UPDATE
  `;
  if (!tenant?.isActive) unavailable();
}

async function lockApplicationRequest(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
) {
  const [request] = await transaction.$queryRaw<LockedApplicationRequest[]>`
    SELECT "id", "status", "items", "sourcing", "quoteDeadline",
           "applicationTokenDigest", "applicationExpiresAt",
           "applicationRevokedAt", pg_catalog.clock_timestamp() AS "now"
    FROM "ProcurementRequest"
    WHERE "tenantId" = ${tenantId}
      AND "id" = ${requestId}
    FOR UPDATE
  `;
  if (!request) unavailable();
  return request;
}

function assertLiveApplicationRequest(
  request: LockedApplicationRequest,
  tokenDigest: string,
) {
  if (
    request.status !== 'OPEN' ||
    request.applicationTokenDigest !== tokenDigest ||
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
    unavailable();
  }
  try {
    const documents = validateRequestDocuments(request.items, request.sourcing);
    if (!requestAcceptsVerifiedApplications(
      documents.items,
      documents.sourcing,
    )) {
      unavailable();
    }
  } catch (error) {
    if (
      error instanceof PublicSupplierApplicationUnavailableError ||
      error instanceof RequestDocumentValidationError
    ) {
      unavailable();
    }
    throw error;
  }
}

async function hasDuplicateContact(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  application: ValidPublicSupplierApplication,
) {
  const contactFilters: Prisma.SupplierWhereInput[] = [];
  if (application.email) {
    contactFilters.push({
      email: { equals: application.email, mode: 'insensitive' },
    });
  }
  const phoneContacts = [...new Set([
    application.phone,
    application.whatsappNumber,
  ].filter((value): value is string => Boolean(value)))];
  if (phoneContacts.length > 0) {
    contactFilters.push(
      { phone: { in: phoneContacts } },
      { whatsappNumber: { in: phoneContacts } },
    );
  }
  return Boolean(await transaction.supplier.findFirst({
    where: { tenantId, OR: contactFilters },
    select: { id: true },
  }));
}

export async function submitPublicSupplierApplication(
  input: { application: unknown; now: Date },
  client: PublicApplicationClient = prisma,
  options: PublicApplicationOptions = {},
) {
  const application = validatePublicSupplierApplicationInput(input.application);
  const exchange = options.exchange ?? exchangeSupplierApplicationGrantToken;
  const grant = await exchange({ token: application.token, now: input.now });
  const tokenDigest = digestOpaqueToken(
    'supplier-application',
    application.token,
  );

  return withTenant(grant.tenantId, async (transaction) => {
    await lockTenant(transaction, grant.tenantId);
    const request = await lockApplicationRequest(
      transaction,
      grant.tenantId,
      grant.requestId,
    );
    assertLiveApplicationRequest(request, tokenDigest);

    if (await hasDuplicateContact(transaction, grant.tenantId, application)) {
      return { accepted: true } as const;
    }
    const pendingCount = await transaction.supplier.count({
      where: {
        tenantId: grant.tenantId,
        applicationRequestId: grant.requestId,
        relationshipType: 'APPLICANT',
        verificationStatus: 'PENDING',
      },
    });
    if (pendingCount >= PUBLIC_SUPPLIER_APPLICATION_PENDING_CAP) {
      return { accepted: true } as const;
    }

    const supplierId = (options.idFactory ?? randomUUID)();
    validateSupplierLifecycleState({
      relationshipType: 'APPLICANT',
      verificationStatus: 'PENDING',
      applicationRequestId: grant.requestId,
      verifiedAt: null,
      verifiedByUserId: null,
      isActive: false,
    });
    const created = await transaction.supplier.create({
      data: {
        id: supplierId,
        tenantId: grant.tenantId,
        businessName: application.businessName,
        contactName: application.contactName,
        phone: application.phone,
        whatsappNumber: application.whatsappNumber,
        email: application.email,
        relationshipType: 'APPLICANT',
        verificationStatus: 'PENDING',
        applicationRequestId: grant.requestId,
        capabilities: application.capabilities as unknown as Prisma.InputJsonValue,
        verifiedAt: null,
        verifiedByUserId: null,
        isActive: false,
      },
      select: { id: true },
    });
    await writeAuditEvent(transaction, {
      tenantId: grant.tenantId,
      actorUserId: null,
      action: 'supplier.applied',
      entityId: created.id,
      metadata: {
        requestId: grant.requestId,
        categoryCount: application.categories.length,
      },
    });
    return { accepted: true } as const;
  }, client);
}
