import { DOCUMENT_LIMITS } from './document-limits';
import {
  PROCUREMENT_CATEGORIES,
  ProcurementCategory,
} from './procurement-categories';

const TEXT_LIMITS = {
  description: 500,
  preferredBrand: 120,
  packSize: 120,
  qualityGrade: 120,
  notes: 1000,
} as const;

const ALLOWED_KEYS = new Set([
  'v',
  'category',
  'description',
  'preferredBrand',
  'packSize',
  'qualityGrade',
  'notes',
  'referenceUrl',
  'thumbnailWebpBase64',
]);

type NullableTextField = keyof typeof TEXT_LIMITS;

export interface ItemSpecificationV1 {
  v: 1;
  category: ProcurementCategory;
  description?: string | null;
  preferredBrand?: string | null;
  packSize?: string | null;
  qualityGrade?: string | null;
  notes?: string | null;
  referenceUrl?: string | null;
  thumbnailWebpBase64?: string | null;
}

export class ItemSpecificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemSpecificationValidationError';
  }
}

function fail(message: string): never {
  throw new ItemSpecificationValidationError(message);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

function isCanonicalText(value: string): boolean {
  return (
    value.length > 0 &&
    value.trim() === value &&
    !value.includes('\r') &&
    !value.includes('\u0000') &&
    !hasUnpairedSurrogate(value)
  );
}

function validateTextField(
  input: Record<string, unknown>,
  field: NullableTextField,
): void {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return;

  const value = input[field];
  if (value === null) return;
  if (
    typeof value !== 'string' ||
    !isCanonicalText(value) ||
    value.length > TEXT_LIMITS[field]
  ) {
    fail(
      `${field} must be null or canonical text of at most ${TEXT_LIMITS[field]} characters.`,
    );
  }
}

function validateReferenceUrl(input: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(input, 'referenceUrl')) return;

  const value = input.referenceUrl;
  if (value === null) return;
  if (
    typeof value !== 'string' ||
    !isCanonicalText(value) ||
    value.length > DOCUMENT_LIMITS.itemSpecification.referenceUrlCharacters
  ) {
    fail('referenceUrl must be null or a canonical HTTPS URL of at most 2048 characters.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('referenceUrl must be a canonical HTTPS URL.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    parsed.toString() !== value
  ) {
    fail('referenceUrl must be a canonical HTTPS URL without credentials or a fragment.');
  }
}

function isCanonicalBase64(value: string): boolean {
  return (
    value.length > 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}

function validateThumbnail(input: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(input, 'thumbnailWebpBase64')) return;

  const value = input.thumbnailWebpBase64;
  if (value === null) return;
  if (typeof value !== 'string' || !isCanonicalBase64(value)) {
    fail('thumbnailWebpBase64 must be null or canonical base64.');
  }

  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    fail('thumbnailWebpBase64 must be canonical base64.');
  }

  if (btoa(decoded) !== value) {
    fail('thumbnailWebpBase64 must be canonical base64.');
  }
  if (decoded.length > DOCUMENT_LIMITS.itemSpecification.thumbnailDecodedBytes) {
    fail('thumbnailWebpBase64 must decode to no more than 48 KiB.');
  }
  if (
    decoded.length < 12 ||
    decoded.slice(0, 4) !== 'RIFF' ||
    decoded.slice(8, 12) !== 'WEBP'
  ) {
    fail('thumbnailWebpBase64 must contain a WebP RIFF signature.');
  }
}

function itemSpecificationRecord(input: unknown): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    fail('Item specification must be a plain JSON object.');
  }

  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !ALLOWED_KEYS.has(key)) {
      fail(`Item specification contains unknown key ${String(key)}.`);
    }

    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail(`Item specification key ${key} must be an enumerable data property.`);
    }
  }

  return input as Record<string, unknown>;
}

export function validateItemSpecification(input: unknown): ItemSpecificationV1 {
  const specification = itemSpecificationRecord(input);

  if (specification.v !== 1) fail('Item specification version must be 1.');
  if (
    typeof specification.category !== 'string' ||
    !Object.prototype.hasOwnProperty.call(PROCUREMENT_CATEGORIES, specification.category)
  ) {
    fail('Item specification category is not supported.');
  }

  for (const field of Object.keys(TEXT_LIMITS) as NullableTextField[]) {
    validateTextField(specification, field);
  }
  validateReferenceUrl(specification);
  validateThumbnail(specification);

  return { ...specification } as unknown as ItemSpecificationV1;
}
