import {
  emptySupplierCapabilities,
  type SupplierCapabilitiesV1,
  SupplierCapabilitiesValidationError,
  validateSupplierCapabilities,
} from '@/lib/suppliers/supplier-capabilities';

export const SUPPLIER_LIMITS = {
  businessNameBytes: 160,
  contactNameBytes: 120,
  addressBytes: 320,
  placeBytes: 100,
  notesBytes: 2_000,
  emailBytes: 320,
  searchBytes: 160,
  cursorBytes: 1_024,
  listPage: 50,
} as const;

type SupplierErrors = Record<string, string[]>;

export type SupplierCreateInput = {
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
  notes: string | null;
  isActive: boolean;
  relationshipType: 'CURRENT' | 'SELECTED_NEW';
  capabilities: SupplierCapabilitiesV1;
};

export type SupplierUpdateInput = Partial<SupplierCreateInput>;

export type SupplierListInput = {
  active: boolean | null;
  search: string | undefined;
  limit: number;
  cursor: string | undefined;
};

export type SupplierLifecycleState = {
  relationshipType: 'CURRENT' | 'SELECTED_NEW' | 'APPLICANT';
  verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  applicationRequestId: string | null;
  verifiedAt: Date | null;
  verifiedByUserId: string | null;
  isActive: boolean;
};

export type SupplierVerificationDecision = 'APPROVE' | 'REJECT';

const SUPPLIER_FIELDS = new Set([
  'businessName', 'contactName', 'phone', 'whatsappNumber', 'email',
  'addressLine', 'city', 'state', 'pin', 'gstin', 'notes', 'isActive',
  'relationshipType', 'capabilities',
]);
const LIFECYCLE_FIELDS = new Set([
  'relationshipType', 'verificationStatus', 'applicationRequestId',
  'verifiedAt', 'verifiedByUserId', 'isActive',
]);

export class SupplierValidationError extends Error {
  readonly code = 'INVALID_SUPPLIER';
  readonly status = 422;

  constructor(readonly errors: Record<string, string[]>) {
    super('The supplier contains invalid or unbounded fields.');
    this.name = 'SupplierValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  errors: SupplierErrors,
) {
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      errors[String(key)] = ['This supplier field cannot be set here.'];
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      errors[key] = ['Supplier fields must be enumerable data properties.'];
    }
  }
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function boundedRequiredText(
  value: unknown,
  field: string,
  label: string,
  maximumBytes: number,
  errors: SupplierErrors,
) {
  if (typeof value !== 'string' || !value.trim()) {
    errors[field] = [`${label} is required.`];
    return null;
  }
  const normalized = value.trim();
  if (
    byteLength(normalized) > maximumBytes ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    errors[field] = [
      `${label} must be ${maximumBytes.toLocaleString('en-IN')} UTF-8 bytes or fewer and contain no control characters.`,
    ];
    return null;
  }
  return normalized;
}

function boundedOptionalText(
  value: unknown,
  field: string,
  label: string,
  maximumBytes: number,
  errors: SupplierErrors,
) {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string') {
    errors[field] = [`${label} must be text when provided.`];
    return null;
  }
  const normalized = value.trim();
  if (
    byteLength(normalized) > maximumBytes ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    errors[field] = [
      `${label} must be ${maximumBytes.toLocaleString('en-IN')} UTF-8 bytes or fewer and contain no control characters.`,
    ];
    return null;
  }
  return normalized;
}

/** Stores phone and WhatsApp contacts in E.164 form; local Indian mobiles gain +91. */
export function normalizeSupplierPhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  const international = compact.startsWith('00')
    ? `+${compact.slice(2)}`
    : compact;

  if (/^[6-9]\d{9}$/.test(international)) return `+91${international}`;
  if (/^91[6-9]\d{9}$/.test(international)) return `+${international}`;
  if (/^\+[1-9]\d{7,14}$/.test(international)) return international;
  throw new TypeError('Use a valid phone number, including country code when outside India.');
}

function optionalPhone(
  value: unknown,
  field: 'phone' | 'whatsappNumber',
  errors: SupplierErrors,
) {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string') {
    errors[field] = ['Phone number must be text when provided.'];
    return null;
  }
  try {
    return normalizeSupplierPhone(value);
  } catch {
    errors[field] = [
      'Use a valid phone number, including country code when outside India.',
    ];
    return null;
  }
}

function optionalEmail(value: unknown, errors: SupplierErrors) {
  const normalized = boundedOptionalText(
    value,
    'email',
    'Email',
    SUPPLIER_LIMITS.emailBytes,
    errors,
  );
  if (normalized === undefined || normalized === null) return normalized;
  const lower = normalized.toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(lower)) {
    errors.email = ['Use a valid email address.'];
    return null;
  }
  return lower;
}

function optionalPin(value: unknown, errors: SupplierErrors) {
  const normalized = boundedOptionalText(value, 'pin', 'PIN', 6, errors);
  if (normalized === undefined || normalized === null) return normalized;
  if (!/^[1-9]\d{5}$/.test(normalized)) {
    errors.pin = ['Use a valid 6-digit Indian PIN.'];
    return null;
  }
  return normalized;
}

function optionalGstin(value: unknown, errors: SupplierErrors) {
  const normalized = boundedOptionalText(value, 'gstin', 'GSTIN', 15, errors);
  if (normalized === undefined || normalized === null) return normalized;
  const upper = normalized.toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(upper)) {
    errors.gstin = ['Use a valid 15-character Indian GSTIN.'];
    return null;
  }
  return upper;
}

function optionalActive(value: unknown, errors: SupplierErrors) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    errors.isActive = ['Active status must be true or false.'];
    return undefined;
  }
  return value;
}

function optionalRelationshipType(value: unknown, errors: SupplierErrors) {
  if (value === undefined) return undefined;
  if (value !== 'CURRENT' && value !== 'SELECTED_NEW') {
    errors.relationshipType = [
      'Relationship type must be CURRENT or SELECTED_NEW.',
    ];
    return undefined;
  }
  return value;
}

function optionalCapabilities(value: unknown, errors: SupplierErrors) {
  if (value === undefined) return undefined;
  try {
    return validateSupplierCapabilities(value);
  } catch (error) {
    if (!(error instanceof SupplierCapabilitiesValidationError)) throw error;
    errors.capabilities = [error.message];
    return undefined;
  }
}

function validateFields(input: Record<string, unknown>, requireBusinessName: boolean) {
  const errors: SupplierErrors = {};
  const result: SupplierUpdateInput = {};

  if (requireBusinessName || Object.prototype.hasOwnProperty.call(input, 'businessName')) {
    const value = boundedRequiredText(
      input.businessName,
      'businessName',
      'Business name',
      SUPPLIER_LIMITS.businessNameBytes,
      errors,
    );
    if (value) result.businessName = value;
  }

  const optionalFields = [
    ['contactName', 'Contact name', SUPPLIER_LIMITS.contactNameBytes],
    ['addressLine', 'Address', SUPPLIER_LIMITS.addressBytes],
    ['city', 'City', SUPPLIER_LIMITS.placeBytes],
    ['state', 'State', SUPPLIER_LIMITS.placeBytes],
    ['notes', 'Notes', SUPPLIER_LIMITS.notesBytes],
  ] as const;
  for (const [field, label, maximumBytes] of optionalFields) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    const value = boundedOptionalText(
      input[field],
      field,
      label,
      maximumBytes,
      errors,
    );
    if (value !== undefined) result[field] = value;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'phone')) {
    result.phone = optionalPhone(input.phone, 'phone', errors) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'whatsappNumber')) {
    result.whatsappNumber =
      optionalPhone(input.whatsappNumber, 'whatsappNumber', errors) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'email')) {
    result.email = optionalEmail(input.email, errors) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'pin')) {
    result.pin = optionalPin(input.pin, errors) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'gstin')) {
    result.gstin = optionalGstin(input.gstin, errors) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'isActive')) {
    const active = optionalActive(input.isActive, errors);
    if (active !== undefined) result.isActive = active;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'relationshipType')) {
    const relationshipType = optionalRelationshipType(input.relationshipType, errors);
    if (relationshipType !== undefined) result.relationshipType = relationshipType;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'capabilities')) {
    const capabilities = optionalCapabilities(input.capabilities, errors);
    if (capabilities !== undefined) result.capabilities = capabilities;
  }

  if (Object.keys(errors).length > 0) throw new SupplierValidationError(errors);
  return result;
}

export function validateSupplierCreateInput(input: unknown): SupplierCreateInput {
  if (!isRecord(input)) {
    throw new SupplierValidationError({ body: ['Expected a JSON object.'] });
  }
  const unknownErrors: SupplierErrors = {};
  rejectUnknownKeys(input, SUPPLIER_FIELDS, unknownErrors);
  if (Object.keys(unknownErrors).length > 0) {
    throw new SupplierValidationError(unknownErrors);
  }
  const valid = validateFields(input, true);
  return {
    businessName: valid.businessName!,
    contactName: valid.contactName ?? null,
    phone: valid.phone ?? null,
    whatsappNumber: valid.whatsappNumber ?? null,
    email: valid.email ?? null,
    addressLine: valid.addressLine ?? null,
    city: valid.city ?? null,
    state: valid.state ?? null,
    pin: valid.pin ?? null,
    gstin: valid.gstin ?? null,
    notes: valid.notes ?? null,
    isActive: valid.isActive ?? true,
    relationshipType: valid.relationshipType ?? 'CURRENT',
    capabilities: valid.capabilities ?? emptySupplierCapabilities(),
  };
}

export function validateSupplierUpdateInput(input: unknown): SupplierUpdateInput {
  if (!isRecord(input)) {
    throw new SupplierValidationError({ body: ['Expected a JSON object.'] });
  }
  const unknownErrors: SupplierErrors = {};
  rejectUnknownKeys(input, SUPPLIER_FIELDS, unknownErrors);
  if (Object.keys(unknownErrors).length > 0) {
    throw new SupplierValidationError(unknownErrors);
  }
  const valid = validateFields(input, false);
  if (Object.keys(valid).length === 0) {
    throw new SupplierValidationError({
      body: ['Provide at least one supplier field to update.'],
    });
  }
  return valid;
}

function validLifecycleId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

export function validateSupplierLifecycleState(input: unknown): SupplierLifecycleState {
  if (!isRecord(input)) {
    throw new SupplierValidationError({ lifecycle: ['Expected a lifecycle object.'] });
  }
  const errors: SupplierErrors = {};
  rejectUnknownKeys(input, LIFECYCLE_FIELDS, errors);
  const state = input as unknown as SupplierLifecycleState;
  if (typeof state.isActive !== 'boolean') {
    errors.isActive = ['Active status must be true or false.'];
  }
  const hasApplication = state.applicationRequestId !== null &&
    validLifecycleId(state.applicationRequestId);
  const hasVerification = state.verifiedAt instanceof Date &&
    !Number.isNaN(state.verifiedAt.getTime()) && validLifecycleId(state.verifiedByUserId);
  const hasNoVerification = state.verifiedAt === null && state.verifiedByUserId === null;

  if (state.relationshipType === 'APPLICANT') {
    if (
      (state.verificationStatus !== 'PENDING' && state.verificationStatus !== 'REJECTED') ||
      state.isActive !== false || !hasApplication || !hasNoVerification
    ) {
      errors.lifecycle = [
        'Applicants must be inactive PENDING or REJECTED records linked to an application request.',
      ];
    }
  } else if (
    state.relationshipType === 'CURRENT' || state.relationshipType === 'SELECTED_NEW'
  ) {
    if (
      state.verificationStatus !== 'VERIFIED' || !hasVerification ||
      (state.relationshipType === 'CURRENT' && state.applicationRequestId !== null) ||
      (state.applicationRequestId !== null && !hasApplication)
    ) {
      errors.lifecycle = [
        'Direct suppliers must be verified with a reviewer and review time.',
      ];
    }
  } else {
    errors.relationshipType = ['Supplier relationship type is not supported.'];
  }
  if (Object.keys(errors).length > 0) throw new SupplierValidationError(errors);
  return state;
}

export function validateSupplierVerificationDecision(
  input: unknown,
): SupplierVerificationDecision {
  if (!isRecord(input)) {
    throw new SupplierValidationError({ body: ['Expected a JSON object.'] });
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 1 || keys[0] !== 'decision' ||
    !Object.getOwnPropertyDescriptor(input, 'decision')?.enumerable ||
    (input.decision !== 'APPROVE' && input.decision !== 'REJECT')
  ) {
    throw new SupplierValidationError({
      decision: ['Decision must be APPROVE or REJECT.'],
    });
  }
  return input.decision;
}

function boundedQueryText(
  value: unknown,
  field: 'search' | 'cursor',
  maximumBytes: number,
  errors: SupplierErrors,
) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    errors[field] = [`${field === 'search' ? 'Search' : 'Cursor'} must be text.`];
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (
    byteLength(normalized) > maximumBytes ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    errors[field] = [
      `${field === 'search' ? 'Search' : 'Cursor'} is too long or contains invalid characters.`,
    ];
    return undefined;
  }
  return normalized;
}

export function validateSupplierListInput(input: {
  active?: unknown;
  search?: unknown;
  limit?: unknown;
  cursor?: unknown;
}): SupplierListInput {
  const errors: SupplierErrors = {};
  let active: boolean | null = true;
  if (input.active === 'all' || input.active === null) active = null;
  else if (input.active === 'false' || input.active === false) active = false;
  else if (
    input.active !== undefined &&
    input.active !== 'true' &&
    input.active !== true
  ) {
    errors.active = ['Active filter must be true, false, or all.'];
  }

  const limit = input.limit === undefined ? 25 : Number(input.limit);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > SUPPLIER_LIMITS.listPage
  ) {
    errors.limit = [
      `Limit must be between 1 and ${SUPPLIER_LIMITS.listPage}.`,
    ];
  }
  const search = boundedQueryText(
    input.search,
    'search',
    SUPPLIER_LIMITS.searchBytes,
    errors,
  );
  const cursor = boundedQueryText(
    input.cursor,
    'cursor',
    SUPPLIER_LIMITS.cursorBytes,
    errors,
  );
  if (Object.keys(errors).length > 0) throw new SupplierValidationError(errors);

  return { active, search, limit, cursor };
}
