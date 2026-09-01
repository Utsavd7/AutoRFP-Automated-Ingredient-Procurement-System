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

const MAX_THUMBNAIL_BASE64_CHARACTERS =
  Math.ceil(DOCUMENT_LIMITS.itemSpecification.thumbnailDecodedBytes / 3) * 4;

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

function hasNonCanonicalPercentEncoding(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '%') continue;

    const encodedByte = value.slice(index + 1, index + 3);
    if (!/^[0-9A-F]{2}$/.test(encodedByte)) return true;

    const decodedByte = String.fromCharCode(Number.parseInt(encodedByte, 16));
    if (/^[A-Za-z0-9._~-]$/.test(decodedByte)) return true;
    index += 2;
  }

  return false;
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
    value.includes('#') ||
    value.endsWith('?') ||
    hasNonCanonicalPercentEncoding(value) ||
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

function readUint32LittleEndian(value: string, offset: number): number {
  return (
    value.charCodeAt(offset) +
    value.charCodeAt(offset + 1) * 0x100 +
    value.charCodeAt(offset + 2) * 0x10000 +
    value.charCodeAt(offset + 3) * 0x1000000
  );
}

function isVp8KeyFrame(value: string, offset: number, length: number): boolean {
  return (
    length >= 10 &&
    (value.charCodeAt(offset) & 1) === 0 &&
    value.charCodeAt(offset + 3) === 0x9d &&
    value.charCodeAt(offset + 4) === 0x01 &&
    value.charCodeAt(offset + 5) === 0x2a
  );
}

function isVp8lHeader(value: string, offset: number, length: number): boolean {
  return (
    length >= 5 &&
    value.charCodeAt(offset) === 0x2f &&
    (value.charCodeAt(offset + 4) & 0xe0) === 0
  );
}

interface WebpChunk {
  tag: string;
  length: number;
  dataOffset: number;
  dataEnd: number;
  nextOffset: number;
}

function readWebpChunk(value: string, offset: number, limit: number): WebpChunk | null {
  if (offset + 8 > limit) return null;
  const length = readUint32LittleEndian(value, offset + 4);
  const dataOffset = offset + 8;
  const dataEnd = dataOffset + length;
  const nextOffset = dataEnd + (length % 2);
  if (dataEnd > limit || nextOffset > limit) return null;
  return { tag: value.slice(offset, offset + 4), length, dataOffset, dataEnd, nextOffset };
}

function imageChunkStatus(value: string, chunk: WebpChunk): -1 | 0 | 1 {
  if (chunk.tag === 'VP8 ') {
    return isVp8KeyFrame(value, chunk.dataOffset, chunk.length) ? 1 : -1;
  }
  if (chunk.tag === 'VP8L') {
    return isVp8lHeader(value, chunk.dataOffset, chunk.length) ? 1 : -1;
  }
  return 0;
}

function nestedFrameHasImage(value: string, start: number, end: number): boolean | null {
  let offset = start;
  let hasImage = false;
  while (offset < end) {
    const chunk = readWebpChunk(value, offset, end);
    if (!chunk) return null;
    const status = imageChunkStatus(value, chunk);
    if (status < 0) return null;
    if (status > 0) hasImage = true;
    offset = chunk.nextOffset;
  }
  return hasImage;
}

function isWebp(value: string): boolean {
  if (
    value.length < 12 ||
    value.slice(0, 4) !== 'RIFF' ||
    value.slice(8, 12) !== 'WEBP' ||
    readUint32LittleEndian(value, 4) !== value.length - 8
  ) {
    return false;
  }

  let offset = 12;
  let hasImageData = false;
  let animationFlag = false;
  let sawVp8x = false;
  let sawAnim = false;
  let sawAnmf = false;
  while (offset < value.length) {
    const chunk = readWebpChunk(value, offset, value.length);
    if (!chunk) return false;
    if (chunk.tag === 'VP8X') {
      if (chunk.length !== 10 || sawVp8x) return false;
      sawVp8x = true;
      animationFlag = (value.charCodeAt(chunk.dataOffset) & 0x02) !== 0;
      if (animationFlag && offset !== 12) return false;
    }
    if (chunk.tag === 'ANIM') {
      if (!animationFlag || !sawVp8x || sawAnim || sawAnmf || chunk.length !== 6) {
        return false;
      }
      sawAnim = true;
    }

    const status = imageChunkStatus(value, chunk);
    if (status < 0) return false;
    if (status > 0) hasImageData = true;
    if (chunk.tag === 'ANMF') {
      if (
        !animationFlag ||
        !sawVp8x ||
        !sawAnim ||
        chunk.length < 16 ||
        (value.charCodeAt(chunk.dataOffset + 15) & 0xfc) !== 0
      ) {
        return false;
      }
      const nestedImage = nestedFrameHasImage(value, chunk.dataOffset + 16, chunk.dataEnd);
      if (!nestedImage) return false;
      hasImageData = true;
      sawAnmf = true;
    }
    offset = chunk.nextOffset;
  }

  return hasImageData && (!animationFlag || (sawAnim && sawAnmf));
}

function validateThumbnail(input: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(input, 'thumbnailWebpBase64')) return;

  const value = input.thumbnailWebpBase64;
  if (value === null) return;
  if (typeof value !== 'string') {
    fail('thumbnailWebpBase64 must be null or canonical base64.');
  }
  if (value.length > MAX_THUMBNAIL_BASE64_CHARACTERS) {
    fail('thumbnailWebpBase64 must represent a WebP no larger than 48 KiB.');
  }
  if (!isCanonicalBase64(value)) {
    fail('thumbnailWebpBase64 must be null or canonical base64.');
  }

  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    fail('thumbnailWebpBase64 must be canonical base64.');
  }

  if (decoded.length > DOCUMENT_LIMITS.itemSpecification.thumbnailDecodedBytes) {
    fail('thumbnailWebpBase64 must decode to no more than 48 KiB.');
  }
  if (btoa(decoded) !== value) {
    fail('thumbnailWebpBase64 must be canonical base64.');
  }
  if (!isWebp(decoded)) {
    fail('thumbnailWebpBase64 must contain a structurally valid WebP image chunk.');
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
