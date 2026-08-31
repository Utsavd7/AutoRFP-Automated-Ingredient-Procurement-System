import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import type { ItemSpecificationV1 } from '@/lib/domain/item-specification';
import {
  calculateGst,
  multiplyPaise,
  parseInrToPaise,
} from '@/lib/domain/money';
import { assertBoundedJson } from '@/lib/domain/postgres-json';
import type { ProcurementUnit } from '@/lib/domain/quantity';
import {
  assertMaximum,
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  MAX_SIGNED_BIGINT,
  parseUnsignedFixed,
} from '@/lib/domain/validation';

export const PUBLIC_QUOTE_MAX_ITEMS = 250;
export const PUBLIC_QUOTE_MAX_REVISIONS = DOCUMENT_LIMITS.quoteRevisions.revisions;
export const PUBLIC_QUOTE_DOCUMENT_BYTES = DOCUMENT_LIMITS.quoteRevisions.jsonBytes;

type ValidationErrors = Record<string, string[]>;

export class PublicQuoteValidationError extends Error {
  readonly code = 'INVALID_PUBLIC_QUOTE';
  readonly status = 422;

  constructor(readonly errors: ValidationErrors) {
    super('The supplier quote contains invalid or unbounded fields.');
    this.name = 'PublicQuoteValidationError';
  }
}

export class PublicQuoteRevisionConflictError extends Error {
  readonly code = 'QUOTE_REVISION_CONFLICT';
  readonly status = 409;

  constructor() {
    super('A newer quote was already submitted. Review it before trying again.');
    this.name = 'PublicQuoteRevisionConflictError';
  }
}

export class PublicQuoteRevisionLimitError extends Error {
  readonly code = 'QUOTE_REVISION_LIMIT';
  readonly status = 409;

  constructor() {
    super(
      'This supplier link has reached its quote revision limit. Ask the restaurant for a new request.',
    );
    this.name = 'PublicQuoteRevisionLimitError';
  }
}

export class PublicQuoteDocumentSizeError extends Error {
  readonly code = 'QUOTE_DOCUMENT_SIZE_LIMIT';
  readonly status = 409;

  constructor() {
    super(
      'This supplier link has reached its quote document size limit. Ask the restaurant for a new request.',
    );
    this.name = 'PublicQuoteDocumentSizeError';
  }
}

export class PublicQuoteStorageCorruptionError extends Error {
  readonly code = 'QUOTE_STORAGE_CORRUPTION';
  readonly status = 503;

  constructor() {
    super('Stored supplier quote data is not valid.');
    this.name = 'PublicQuoteStorageCorruptionError';
  }
}

export type QuoteRequestItem = {
  id: string;
  itemKey: string;
  name: string;
  quantity: string;
  unit: ProcurementUnit;
  specification: ItemSpecificationV1;
};

export type QuoteRevisionItemV1 = {
  requestItemId: string;
  noQuote: boolean;
  availableQuantity: string | null;
  unit: ProcurementUnit | null;
  unitRatePaise: string | null;
  gstBasisPoints: number | null;
  taxInclusive: boolean;
  suppliedBrand: string | null;
  suppliedPackSize: string | null;
  suppliedQualityGrade: string | null;
  substitution: string | null;
  subtotalPaise: string;
  gstPaise: string;
  totalPaise: string;
};

export type QuoteRevisionV1 = {
  revision: number;
  submittedAt: string;
  deliveryDate: string;
  validUntil: string;
  minimumOrder: string | null;
  freightPaise: string;
  commercialTerms: string | null;
  notes: string | null;
  items: QuoteRevisionItemV1[];
  subtotalPaise: string;
  gstPaise: string;
  totalPaise: string;
};

export type QuoteRevisionsV1 = {
  v: 1;
  revisions: QuoteRevisionV1[];
};

export const EMPTY_QUOTE_REVISIONS: QuoteRevisionsV1 = {
  v: 1,
  revisions: [],
};

const UNITS = new Set<ProcurementUnit>([
  'KILOGRAM',
  'GRAM',
  'LITRE',
  'MILLILITRE',
  'PIECE',
  'PACK',
  'CASE',
  'CRATE',
]);
const DOCUMENT_KEYS = new Set(['v', 'revisions']);
const REVISION_KEYS = new Set([
  'revision',
  'submittedAt',
  'deliveryDate',
  'validUntil',
  'minimumOrder',
  'freightPaise',
  'commercialTerms',
  'notes',
  'items',
  'subtotalPaise',
  'gstPaise',
  'totalPaise',
]);
const STORED_ITEM_KEYS = new Set([
  'requestItemId',
  'noQuote',
  'availableQuantity',
  'unit',
  'unitRatePaise',
  'gstBasisPoints',
  'taxInclusive',
  'suppliedBrand',
  'suppliedPackSize',
  'suppliedQualityGrade',
  'substitution',
  'subtotalPaise',
  'gstPaise',
  'totalPaise',
]);
const SUBMISSION_KEYS = new Set([
  'deliveryDate',
  'validUntil',
  'minimumOrder',
  'freightInr',
  'commercialTerms',
  'notes',
  'items',
]);
const SUBMISSION_ITEM_KEYS = new Set([
  'requestItemId',
  'noQuote',
  'availableQuantity',
  'unit',
  'unitRateInr',
  'gstPercent',
  'taxInclusive',
  'suppliedBrand',
  'suppliedPackSize',
  'suppliedQualityGrade',
  'substitution',
]);

const TEXT_BYTES = {
  minimumOrder: 500,
  commercialTerms: 2_000,
  notes: 4_000,
  suppliedBrand: 120,
  suppliedPackSize: 120,
  suppliedQualityGrade: 120,
  substitution: 500,
} as const;

function validationFailure(path: string, message: string): never {
  throw new PublicQuoteValidationError({ [path]: [message] });
}

function storageFailure(): never {
  throw new PublicQuoteStorageCorruptionError();
}

function isDataObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return false;
  }
  return true;
}

function plainSubmissionRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  path: string,
) {
  if (!isDataObject(value, allowedKeys)) {
    validationFailure(path, 'Provide a plain object containing only supported fields.');
  }
  return value;
}

function storedRecord(
  value: unknown,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isDataObject(value, keys) || Reflect.ownKeys(value).length !== keys.size) {
    storageFailure();
  }
  return value;
}

function isPlainDenseArray(value: unknown, maximum: number): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) return false;
  }
  return true;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function hasUnsupportedText(value: string) {
  return (
    value.trim() !== value ||
    value.length === 0 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  );
}

function optionalSubmissionText(
  value: unknown,
  path: string,
  maximumBytes: number,
): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    hasUnsupportedText(value) ||
    byteLength(value) > maximumBytes
  ) {
    validationFailure(path, `Use canonical text of at most ${maximumBytes} UTF-8 bytes or null.`);
  }
  return value;
}

function storedOptionalText(value: unknown, maximumBytes: number): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    hasUnsupportedText(value) ||
    byteLength(value) > maximumBytes
  ) {
    storageFailure();
  }
  return value;
}

function dateOnly(value: unknown, invalid: () => never): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalid();
  }
  return value;
}

function submissionDate(value: unknown, path: string, now: Date) {
  const text = dateOnly(value, () =>
    validationFailure(path, 'Use a valid date in YYYY-MM-DD format.'),
  );
  const indiaToday = new Date(now.getTime() + 330 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  if (text < indiaToday) {
    validationFailure(path, 'The date cannot be in the past.');
  }
  return text;
}

function utcTimestamp(value: unknown): string {
  if (typeof value !== 'string') storageFailure();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) storageFailure();
  return value;
}

function canonicalPaise(value: unknown): { text: string; amount: bigint } {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) storageFailure();
  let amount: bigint;
  try {
    amount = parseUnsignedFixed(value, {
      label: 'Paise',
      scale: 0,
      maximumScaled: MAX_SIGNED_BIGINT,
      allowZero: true,
    });
  } catch {
    storageFailure();
  }
  return { text: value, amount };
}

function canonicalQuantity(value: unknown): { text: string; milli: bigint } {
  if (typeof value !== 'string') storageFailure();
  let milli: bigint;
  try {
    milli = parseUnsignedFixed(value, {
      label: 'Quantity',
      scale: 3,
      maximumScaled: MAX_DECIMAL_18_3_SCALED,
      allowZero: false,
    });
  } catch {
    storageFailure();
  }
  const text = formatScaledDecimal(milli, 3);
  if (text !== value) storageFailure();
  return { text, milli };
}

function trustedRequestItems(items: QuoteRequestItem[]) {
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > PUBLIC_QUOTE_MAX_ITEMS
  ) {
    storageFailure();
  }
  const byId = new Map<string, QuoteRequestItem>();
  for (const item of items) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      item.id.length === 0 ||
      item.id.length > 200 ||
      !UNITS.has(item.unit)
    ) {
      storageFailure();
    }
    canonicalQuantity(item.quantity);
    if (byId.has(item.id)) storageFailure();
    byId.set(item.id, item);
  }
  return byId;
}

function sameMoney(actual: unknown, expected: bigint) {
  return canonicalPaise(actual).amount === expected;
}

function canonicalStoredLine(
  input: unknown,
  requestItem: QuoteRequestItem,
): QuoteRevisionItemV1 {
  const line = storedRecord(input, STORED_ITEM_KEYS);
  if (line.requestItemId !== requestItem.id || typeof line.noQuote !== 'boolean') {
    storageFailure();
  }
  if (line.noQuote) {
    if (
      line.availableQuantity !== null ||
      line.unit !== null ||
      line.unitRatePaise !== null ||
      line.gstBasisPoints !== null ||
      line.taxInclusive !== false ||
      line.suppliedBrand !== null ||
      line.suppliedPackSize !== null ||
      line.suppliedQualityGrade !== null ||
      line.substitution !== null ||
      line.subtotalPaise !== '0' ||
      line.gstPaise !== '0' ||
      line.totalPaise !== '0'
    ) {
      storageFailure();
    }
    return {
      requestItemId: requestItem.id,
      noQuote: true,
      availableQuantity: null,
      unit: null,
      unitRatePaise: null,
      gstBasisPoints: null,
      taxInclusive: false,
      suppliedBrand: null,
      suppliedPackSize: null,
      suppliedQualityGrade: null,
      substitution: null,
      subtotalPaise: '0',
      gstPaise: '0',
      totalPaise: '0',
    };
  }

  const available = canonicalQuantity(line.availableQuantity);
  const requested = canonicalQuantity(requestItem.quantity);
  if (available.milli > requested.milli || line.unit !== requestItem.unit) {
    storageFailure();
  }
  const unitRate = canonicalPaise(line.unitRatePaise);
  if (
    !Number.isSafeInteger(line.gstBasisPoints) ||
    Number(line.gstBasisPoints) < 0 ||
    Number(line.gstBasisPoints) > 10_000 ||
    typeof line.taxInclusive !== 'boolean'
  ) {
    storageFailure();
  }
  let totals: ReturnType<typeof calculateGst>;
  try {
    totals = calculateGst({
      amountPaise: multiplyPaise(unitRate.amount, available.text),
      gstBasisPoints: Number(line.gstBasisPoints),
      inclusive: line.taxInclusive,
    });
  } catch {
    storageFailure();
  }
  if (
    !sameMoney(line.subtotalPaise, totals.netPaise) ||
    !sameMoney(line.gstPaise, totals.gstPaise) ||
    !sameMoney(line.totalPaise, totals.grossPaise)
  ) {
    storageFailure();
  }
  return {
    requestItemId: requestItem.id,
    noQuote: false,
    availableQuantity: available.text,
    unit: requestItem.unit,
    unitRatePaise: unitRate.text,
    gstBasisPoints: Number(line.gstBasisPoints),
    taxInclusive: line.taxInclusive,
    suppliedBrand: storedOptionalText(line.suppliedBrand, TEXT_BYTES.suppliedBrand),
    suppliedPackSize: storedOptionalText(
      line.suppliedPackSize,
      TEXT_BYTES.suppliedPackSize,
    ),
    suppliedQualityGrade: storedOptionalText(
      line.suppliedQualityGrade,
      TEXT_BYTES.suppliedQualityGrade,
    ),
    substitution: storedOptionalText(line.substitution, TEXT_BYTES.substitution),
    subtotalPaise: totals.netPaise.toString(),
    gstPaise: totals.gstPaise.toString(),
    totalPaise: totals.grossPaise.toString(),
  };
}

function addBounded(sum: bigint, value: bigint, label: string) {
  return assertMaximum(sum + value, MAX_SIGNED_BIGINT, label);
}

function canonicalStoredRevision(
  input: unknown,
  expectedRevision: number,
  requestItems: QuoteRequestItem[],
): QuoteRevisionV1 {
  const revision = storedRecord(input, REVISION_KEYS);
  if (revision.revision !== expectedRevision) storageFailure();
  if (!isPlainDenseArray(revision.items, PUBLIC_QUOTE_MAX_ITEMS)) storageFailure();
  const rawItems = revision.items;
  if (rawItems.length !== requestItems.length) storageFailure();
  const items = requestItems.map((item, index) =>
    canonicalStoredLine(rawItems[index], item),
  );
  let subtotal = BigInt(0);
  let gst = BigInt(0);
  let itemTotal = BigInt(0);
  try {
    for (const item of items) {
      subtotal = addBounded(subtotal, BigInt(item.subtotalPaise), 'Quote subtotal');
      gst = addBounded(gst, BigInt(item.gstPaise), 'Quote GST');
      itemTotal = addBounded(itemTotal, BigInt(item.totalPaise), 'Quote total');
    }
  } catch {
    storageFailure();
  }
  const freight = canonicalPaise(revision.freightPaise);
  let total: bigint;
  try {
    total = addBounded(itemTotal, freight.amount, 'Landed total');
  } catch {
    storageFailure();
  }
  if (
    !sameMoney(revision.subtotalPaise, subtotal) ||
    !sameMoney(revision.gstPaise, gst) ||
    !sameMoney(revision.totalPaise, total)
  ) {
    storageFailure();
  }
  return {
    revision: expectedRevision,
    submittedAt: utcTimestamp(revision.submittedAt),
    deliveryDate: dateOnly(revision.deliveryDate, storageFailure),
    validUntil: dateOnly(revision.validUntil, storageFailure),
    minimumOrder: storedOptionalText(revision.minimumOrder, TEXT_BYTES.minimumOrder),
    freightPaise: freight.text,
    commercialTerms: storedOptionalText(
      revision.commercialTerms,
      TEXT_BYTES.commercialTerms,
    ),
    notes: storedOptionalText(revision.notes, TEXT_BYTES.notes),
    items,
    subtotalPaise: subtotal.toString(),
    gstPaise: gst.toString(),
    totalPaise: total.toString(),
  };
}

export function validateQuoteRevisionsDocument(
  input: unknown,
  requestItems: QuoteRequestItem[],
): QuoteRevisionsV1 {
  trustedRequestItems(requestItems);
  try {
    assertBoundedJson(input, PUBLIC_QUOTE_DOCUMENT_BYTES, 'Quote revisions');
  } catch {
    storageFailure();
  }
  const root = storedRecord(input, DOCUMENT_KEYS);
  if (root.v !== 1 || !isPlainDenseArray(root.revisions, PUBLIC_QUOTE_MAX_REVISIONS)) {
    storageFailure();
  }
  return {
    v: 1,
    revisions: root.revisions.map((revision, index) =>
      canonicalStoredRevision(revision, index + 1, requestItems),
    ),
  };
}

function parseSubmissionLine(
  input: unknown,
  requestItem: QuoteRequestItem,
  path: string,
): QuoteRevisionItemV1 {
  const line = plainSubmissionRecord(input, SUBMISSION_ITEM_KEYS, path);
  if (line.requestItemId !== requestItem.id) {
    validationFailure(`${path}.requestItemId`, 'Respond to each available item exactly once.');
  }
  if (typeof line.noQuote !== 'boolean') {
    validationFailure(`${path}.noQuote`, 'Choose whether this item can be supplied.');
  }
  if (line.noQuote) {
    return {
      requestItemId: requestItem.id,
      noQuote: true,
      availableQuantity: null,
      unit: null,
      unitRatePaise: null,
      gstBasisPoints: null,
      taxInclusive: false,
      suppliedBrand: null,
      suppliedPackSize: null,
      suppliedQualityGrade: null,
      substitution: null,
      subtotalPaise: '0',
      gstPaise: '0',
      totalPaise: '0',
    };
  }

  if (line.unit !== requestItem.unit) {
    validationFailure(`${path}.unit`, 'Use the same unit as the request.');
  }
  if (typeof line.taxInclusive !== 'boolean') {
    validationFailure(`${path}.taxInclusive`, 'Choose whether GST is included.');
  }
  let availableMilli: bigint;
  let requestedMilli: bigint;
  let unitRatePaise: bigint;
  let gstBasisPoints: number;
  if (typeof line.availableQuantity !== 'string') {
    validationFailure(
      `${path}.availableQuantity`,
      'Enter an exact positive quantity with at most three decimal places.',
    );
  }
  try {
    availableMilli = parseUnsignedFixed(line.availableQuantity, {
      label: 'Available quantity',
      scale: 3,
      maximumScaled: MAX_DECIMAL_18_3_SCALED,
      allowZero: false,
    });
    requestedMilli = parseUnsignedFixed(requestItem.quantity, {
      label: 'Requested quantity',
      scale: 3,
      maximumScaled: MAX_DECIMAL_18_3_SCALED,
      allowZero: false,
    });
  } catch {
    validationFailure(
      `${path}.availableQuantity`,
      'Enter an exact positive quantity with at most three decimal places.',
    );
  }
  if (availableMilli > requestedMilli) {
    validationFailure(
      `${path}.availableQuantity`,
      'Available quantity cannot exceed the requested quantity.',
    );
  }
  if (typeof line.unitRateInr !== 'string') {
    validationFailure(
      `${path}.unitRateInr`,
      'Enter rupees with at most two decimal places.',
    );
  }
  try {
    unitRatePaise = parseInrToPaise(line.unitRateInr);
  } catch {
    validationFailure(
      `${path}.unitRateInr`,
      'Enter rupees with at most two decimal places.',
    );
  }
  if (typeof line.gstPercent !== 'string') {
    validationFailure(`${path}.gstPercent`, 'Enter a GST percentage from 0 to 100.');
  }
  try {
    gstBasisPoints = Number(parseUnsignedFixed(line.gstPercent, {
      label: 'GST percent',
      scale: 2,
      maximumScaled: BigInt(10_000),
      allowZero: true,
    }));
  } catch {
    validationFailure(`${path}.gstPercent`, 'Enter a GST percentage from 0 to 100.');
  }
  const availableQuantity = formatScaledDecimal(availableMilli, 3);
  let totals: ReturnType<typeof calculateGst>;
  try {
    totals = calculateGst({
      amountPaise: multiplyPaise(unitRatePaise, availableQuantity),
      gstBasisPoints,
      inclusive: line.taxInclusive,
    });
  } catch {
    validationFailure(path, 'This line total is outside the supported range.');
  }
  return {
    requestItemId: requestItem.id,
    noQuote: false,
    availableQuantity,
    unit: requestItem.unit,
    unitRatePaise: unitRatePaise.toString(),
    gstBasisPoints,
    taxInclusive: line.taxInclusive,
    suppliedBrand: optionalSubmissionText(
      line.suppliedBrand,
      `${path}.suppliedBrand`,
      TEXT_BYTES.suppliedBrand,
    ),
    suppliedPackSize: optionalSubmissionText(
      line.suppliedPackSize,
      `${path}.suppliedPackSize`,
      TEXT_BYTES.suppliedPackSize,
    ),
    suppliedQualityGrade: optionalSubmissionText(
      line.suppliedQualityGrade,
      `${path}.suppliedQualityGrade`,
      TEXT_BYTES.suppliedQualityGrade,
    ),
    substitution: optionalSubmissionText(
      line.substitution,
      `${path}.substitution`,
      TEXT_BYTES.substitution,
    ),
    subtotalPaise: totals.netPaise.toString(),
    gstPaise: totals.gstPaise.toString(),
    totalPaise: totals.grossPaise.toString(),
  };
}

function newRevision(
  input: unknown,
  requestItems: QuoteRequestItem[],
  revision: number,
  databaseNow: Date,
): QuoteRevisionV1 {
  const quote = plainSubmissionRecord(input, SUBMISSION_KEYS, 'quote');
  if (!isPlainDenseArray(quote.items, PUBLIC_QUOTE_MAX_ITEMS)) {
    validationFailure('items', 'Provide one response for every available item.');
  }
  if (quote.items.length !== requestItems.length) {
    validationFailure('items', 'Provide one response for every available item.');
  }
  const rawById = new Map<string, unknown>();
  quote.items.forEach((raw, index) => {
    const line = plainSubmissionRecord(raw, SUBMISSION_ITEM_KEYS, `items.${index}`);
    const id = typeof line.requestItemId === 'string' ? line.requestItemId : '';
    if (!id || rawById.has(id)) {
      validationFailure(`items.${index}.requestItemId`, 'Respond to each item exactly once.');
    }
    rawById.set(id, raw);
  });
  const items = requestItems.map((item, index) => {
    const raw = rawById.get(item.id);
    if (!raw) {
      validationFailure(`items.${index}`, 'This available item needs a response.');
    }
    return parseSubmissionLine(raw, item, `items.${index}`);
  });
  let freightPaise: bigint;
  if (typeof quote.freightInr !== 'string') {
    validationFailure('freightInr', 'Enter freight in rupees with at most two decimal places.');
  }
  try {
    freightPaise = parseInrToPaise(quote.freightInr);
  } catch {
    validationFailure('freightInr', 'Enter freight in rupees with at most two decimal places.');
  }
  let subtotal = BigInt(0);
  let gst = BigInt(0);
  let itemTotal = BigInt(0);
  let total: bigint;
  try {
    for (const item of items) {
      subtotal = addBounded(subtotal, BigInt(item.subtotalPaise), 'Quote subtotal');
      gst = addBounded(gst, BigInt(item.gstPaise), 'Quote GST');
      itemTotal = addBounded(itemTotal, BigInt(item.totalPaise), 'Quote total');
    }
    total = addBounded(itemTotal, freightPaise, 'Landed total');
  } catch {
    validationFailure('items', 'The quote total is outside the supported range.');
  }
  return {
    revision,
    submittedAt: databaseNow.toISOString(),
    deliveryDate: submissionDate(quote.deliveryDate, 'deliveryDate', databaseNow),
    validUntil: submissionDate(quote.validUntil, 'validUntil', databaseNow),
    minimumOrder: optionalSubmissionText(
      quote.minimumOrder,
      'minimumOrder',
      TEXT_BYTES.minimumOrder,
    ),
    freightPaise: freightPaise.toString(),
    commercialTerms: optionalSubmissionText(
      quote.commercialTerms,
      'commercialTerms',
      TEXT_BYTES.commercialTerms,
    ),
    notes: optionalSubmissionText(quote.notes, 'notes', TEXT_BYTES.notes),
    items,
    subtotalPaise: subtotal.toString(),
    gstPaise: gst.toString(),
    totalPaise: total.toString(),
  };
}

export function appendQuoteRevision(
  existing: unknown,
  submission: unknown,
  options: {
    requestItems: QuoteRequestItem[];
    expectedLatestRevision: number;
    storedLatestRevision?: number;
    databaseNow: Date;
  },
): QuoteRevisionsV1 {
  if (
    !(options.databaseNow instanceof Date) ||
    Number.isNaN(options.databaseNow.getTime()) ||
    !Number.isSafeInteger(options.storedLatestRevision ?? 0) ||
    (options.storedLatestRevision ?? 0) < 0
  ) {
    storageFailure();
  }
  const current = validateQuoteRevisionsDocument(existing, options.requestItems);
  const storedLatestRevision = options.storedLatestRevision ?? current.revisions.length;
  if (storedLatestRevision !== current.revisions.length) storageFailure();
  if (
    !Number.isSafeInteger(options.expectedLatestRevision) ||
    options.expectedLatestRevision < 0 ||
    options.expectedLatestRevision !== storedLatestRevision
  ) {
    throw new PublicQuoteRevisionConflictError();
  }
  if (storedLatestRevision >= PUBLIC_QUOTE_MAX_REVISIONS) {
    throw new PublicQuoteRevisionLimitError();
  }
  const document: QuoteRevisionsV1 = {
    v: 1,
    revisions: [
      ...current.revisions,
      newRevision(
        submission,
        options.requestItems,
        storedLatestRevision + 1,
        options.databaseNow,
      ),
    ],
  };
  try {
    assertBoundedJson(document, PUBLIC_QUOTE_DOCUMENT_BYTES, 'Quote revisions');
  } catch (error) {
    if (error instanceof RangeError) throw new PublicQuoteDocumentSizeError();
    throw error;
  }
  return document;
}

export function latestQuoteRevision(document: QuoteRevisionsV1) {
  return document.revisions.at(-1) ?? null;
}
