import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  type ItemSpecificationV1,
  validateItemSpecification,
} from '@/lib/domain/item-specification';
import { calculateGst, multiplyPaise } from '@/lib/domain/money';
import { assertBoundedJson } from '@/lib/domain/postgres-json';
import type { ProcurementUnit } from '@/lib/domain/quantity';
import {
  assertMaximum,
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  MAX_SIGNED_BIGINT,
  parseUnsignedFixed,
} from '@/lib/domain/validation';

export type AwardAllocationLineV1 = {
  requestItemId: string;
  supplierRequestId: string;
  supplierId: string;
  quoteRevision: number;
  quantity: string;
  unit: ProcurementUnit;
  unitRatePaise: string;
  gstBasisPoints: number;
  subtotalPaise: string;
  gstPaise: string;
  totalPaise: string;
};

export type AwardAllocationLinesV1 = {
  v: 1;
  lines: AwardAllocationLineV1[];
};

export type AwardDescriptiveLineV1 = {
  requestItemId: string;
  itemKey: string;
  itemName: string;
  requestedQuantity: string;
  requestedUnit: ProcurementUnit;
  requestedSpecification: ItemSpecificationV1;
  taxInclusive: boolean;
  suppliedBrand: string | null;
  suppliedPackSize: string | null;
  suppliedQualityGrade: string | null;
  substitution: string | null;
};

export type AwardSupplierSnapshotV1 = {
  supplierId: string;
  supplierRequestId: string;
  quoteRevision: number;
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
  submittedAt: string;
  deliveryDate: string;
  validUntil: string;
  minimumOrder: string | null;
  freightPaise: string;
  commercialTerms: string | null;
  notes: string | null;
  subtotalPaise: string;
  gstPaise: string;
  totalPaise: string;
  lines: AwardDescriptiveLineV1[];
};

export type AwardSupplierSnapshotsV1 = {
  v: 1;
  suppliers: AwardSupplierSnapshotV1[];
};

export type AwardDeliverySnapshotV1 = {
  v: 1;
  requestTitle: string;
  requestedDeliveryDate: string;
  deliveryDetails: {
    addressLine: string;
    city: string;
    state: string;
    pin: string;
    instructions: string | null;
  };
  commercialTerms: string | null;
  buyer: {
    name: string;
    addressLine: string;
    city: string;
    state: string;
    pin: string;
    phone: string;
    gstin: string | null;
  };
};

export class AwardDocumentStorageCorruptionError extends Error {
  readonly code = 'AWARD_STORAGE_CORRUPTION';
  readonly status = 503;

  constructor() {
    super('Stored award documents are not valid.');
    this.name = 'AwardDocumentStorageCorruptionError';
  }
}

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
const ALLOCATION_DOCUMENT_KEYS = new Set(['v', 'lines']);
const ALLOCATION_KEYS = new Set([
  'requestItemId',
  'supplierRequestId',
  'supplierId',
  'quoteRevision',
  'quantity',
  'unit',
  'unitRatePaise',
  'gstBasisPoints',
  'subtotalPaise',
  'gstPaise',
  'totalPaise',
]);
const SUPPLIER_DOCUMENT_KEYS = new Set(['v', 'suppliers']);
const SUPPLIER_KEYS = new Set([
  'supplierId',
  'supplierRequestId',
  'quoteRevision',
  'supplierName',
  'contactName',
  'phone',
  'whatsappNumber',
  'email',
  'addressLine',
  'city',
  'state',
  'pin',
  'gstin',
  'submittedAt',
  'deliveryDate',
  'validUntil',
  'minimumOrder',
  'freightPaise',
  'commercialTerms',
  'notes',
  'subtotalPaise',
  'gstPaise',
  'totalPaise',
  'lines',
]);
const DESCRIPTIVE_LINE_KEYS = new Set([
  'requestItemId',
  'itemKey',
  'itemName',
  'requestedQuantity',
  'requestedUnit',
  'requestedSpecification',
  'taxInclusive',
  'suppliedBrand',
  'suppliedPackSize',
  'suppliedQualityGrade',
  'substitution',
]);
const DELIVERY_KEYS = new Set([
  'v',
  'requestTitle',
  'requestedDeliveryDate',
  'deliveryDetails',
  'commercialTerms',
  'buyer',
]);
const DELIVERY_DETAILS_KEYS = new Set([
  'addressLine',
  'city',
  'state',
  'pin',
  'instructions',
]);
const BUYER_KEYS = new Set([
  'name',
  'addressLine',
  'city',
  'state',
  'pin',
  'phone',
  'gstin',
]);

const TEXT_BYTES = {
  id: 200,
  supplierName: 160,
  contactName: 120,
  addressLine: 400,
  place: 120,
  phone: 40,
  email: 320,
  pin: 12,
  gstin: 20,
  requestTitle: 160,
  itemKey: 80,
  itemName: 160,
  instructions: 1_000,
  minimumOrder: 500,
  commercialTerms: 2_000,
  notes: 4_000,
  suppliedFact: 120,
  substitution: 500,
} as const;

function corrupt(): never {
  throw new AwardDocumentStorageCorruptionError();
}

function boundedDocument(value: unknown, maximumBytes: number) {
  try {
    assertBoundedJson(value, maximumBytes, 'Award document');
  } catch {
    corrupt();
  }
}

function storedRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    corrupt();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== allowedKeys.size) corrupt();
  for (const key of keys) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) corrupt();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) corrupt();
  }
  return value as Record<string, unknown>;
}

function denseArray(
  value: unknown,
  minimum: number,
  maximum: number,
): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < minimum ||
    value.length > maximum
  ) {
    corrupt();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) corrupt();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) corrupt();
  }
  return value;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function canonicalText(value: unknown, maximumBytes: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    byteLength(value) > maximumBytes
  ) {
    corrupt();
  }
  return value;
}

function optionalText(value: unknown, maximumBytes: number): string | null {
  return value === null ? null : canonicalText(value, maximumBytes);
}

function identifier(value: unknown) {
  const text = canonicalText(value, TEXT_BYTES.id);
  if (/[\u0000-\u001f\u007f]/.test(text)) corrupt();
  return text;
}

function revision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) corrupt();
  return Number(value);
}

function canonicalMoney(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) corrupt();
  let amount: bigint;
  try {
    amount = parseUnsignedFixed(value, {
      label: 'Award money',
      scale: 0,
      maximumScaled: MAX_SIGNED_BIGINT,
      allowZero: true,
    });
  } catch {
    corrupt();
  }
  return { text: value, amount };
}

function canonicalQuantity(value: unknown) {
  if (typeof value !== 'string') corrupt();
  let milli: bigint;
  try {
    milli = parseUnsignedFixed(value, {
      label: 'Award quantity',
      scale: 3,
      maximumScaled: MAX_DECIMAL_18_3_SCALED,
      allowZero: false,
    });
  } catch {
    corrupt();
  }
  if (formatScaledDecimal(milli, 3) !== value) corrupt();
  return { text: value, milli };
}

function unit(value: unknown): ProcurementUnit {
  if (typeof value !== 'string' || !UNITS.has(value as ProcurementUnit)) corrupt();
  return value as ProcurementUnit;
}

function gstBasisPoints(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    corrupt();
  }
  return Number(value);
}

function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) corrupt();
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    corrupt();
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') corrupt();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) corrupt();
  return value;
}

function storedSpecification(value: unknown) {
  try {
    return validateItemSpecification(value);
  } catch {
    corrupt();
  }
}

function parseAllocationLine(value: unknown): AwardAllocationLineV1 {
  const line = storedRecord(value, ALLOCATION_KEYS);
  const quantity = canonicalQuantity(line.quantity);
  const rate = canonicalMoney(line.unitRatePaise);
  const subtotal = canonicalMoney(line.subtotalPaise);
  const gst = canonicalMoney(line.gstPaise);
  const total = canonicalMoney(line.totalPaise);
  return {
    requestItemId: identifier(line.requestItemId),
    supplierRequestId: identifier(line.supplierRequestId),
    supplierId: identifier(line.supplierId),
    quoteRevision: revision(line.quoteRevision),
    quantity: quantity.text,
    unit: unit(line.unit),
    unitRatePaise: rate.text,
    gstBasisPoints: gstBasisPoints(line.gstBasisPoints),
    subtotalPaise: subtotal.text,
    gstPaise: gst.text,
    totalPaise: total.text,
  };
}

function parseAllocationDocument(value: unknown): AwardAllocationLinesV1 {
  boundedDocument(value, DOCUMENT_LIMITS.awardLines.jsonBytes);
  const document = storedRecord(value, ALLOCATION_DOCUMENT_KEYS);
  if (document.v !== 1) corrupt();
  const lines = denseArray(
    document.lines,
    1,
    DOCUMENT_LIMITS.awardLines.lines,
  ).map(parseAllocationLine);
  const identities = new Set<string>();
  for (const line of lines) {
    const identity = allocationIdentity(line);
    if (identities.has(identity)) corrupt();
    identities.add(identity);
  }
  return { v: 1, lines };
}

function parseDescriptiveLine(value: unknown): AwardDescriptiveLineV1 {
  const line = storedRecord(value, DESCRIPTIVE_LINE_KEYS);
  if (typeof line.taxInclusive !== 'boolean') corrupt();
  return {
    requestItemId: identifier(line.requestItemId),
    itemKey: canonicalText(line.itemKey, TEXT_BYTES.itemKey),
    itemName: canonicalText(line.itemName, TEXT_BYTES.itemName),
    requestedQuantity: canonicalQuantity(line.requestedQuantity).text,
    requestedUnit: unit(line.requestedUnit),
    requestedSpecification: storedSpecification(line.requestedSpecification),
    taxInclusive: line.taxInclusive,
    suppliedBrand: optionalText(line.suppliedBrand, TEXT_BYTES.suppliedFact),
    suppliedPackSize: optionalText(line.suppliedPackSize, TEXT_BYTES.suppliedFact),
    suppliedQualityGrade: optionalText(
      line.suppliedQualityGrade,
      TEXT_BYTES.suppliedFact,
    ),
    substitution: optionalText(line.substitution, TEXT_BYTES.substitution),
  };
}

function parseSupplierSnapshot(value: unknown): AwardSupplierSnapshotV1 {
  const snapshot = storedRecord(value, SUPPLIER_KEYS);
  const subtotal = canonicalMoney(snapshot.subtotalPaise);
  const gst = canonicalMoney(snapshot.gstPaise);
  const freight = canonicalMoney(snapshot.freightPaise);
  const total = canonicalMoney(snapshot.totalPaise);
  let expectedQuoteTotal: bigint;
  try {
    expectedQuoteTotal = assertMaximum(
      subtotal.amount + gst.amount + freight.amount,
      MAX_SIGNED_BIGINT,
      'Quote total',
    );
  } catch {
    corrupt();
  }
  if (total.amount !== expectedQuoteTotal) corrupt();
  const lines = denseArray(
    snapshot.lines,
    1,
    DOCUMENT_LIMITS.awardLines.lines,
  ).map(parseDescriptiveLine);
  const requestItemIds = new Set<string>();
  for (const line of lines) {
    if (requestItemIds.has(line.requestItemId)) corrupt();
    requestItemIds.add(line.requestItemId);
  }
  return {
    supplierId: identifier(snapshot.supplierId),
    supplierRequestId: identifier(snapshot.supplierRequestId),
    quoteRevision: revision(snapshot.quoteRevision),
    supplierName: canonicalText(snapshot.supplierName, TEXT_BYTES.supplierName),
    contactName: optionalText(snapshot.contactName, TEXT_BYTES.contactName),
    phone: optionalText(snapshot.phone, TEXT_BYTES.phone),
    whatsappNumber: optionalText(snapshot.whatsappNumber, TEXT_BYTES.phone),
    email: optionalText(snapshot.email, TEXT_BYTES.email),
    addressLine: optionalText(snapshot.addressLine, TEXT_BYTES.addressLine),
    city: optionalText(snapshot.city, TEXT_BYTES.place),
    state: optionalText(snapshot.state, TEXT_BYTES.place),
    pin: optionalText(snapshot.pin, TEXT_BYTES.pin),
    gstin: optionalText(snapshot.gstin, TEXT_BYTES.gstin),
    submittedAt: timestamp(snapshot.submittedAt),
    deliveryDate: dateOnly(snapshot.deliveryDate),
    validUntil: dateOnly(snapshot.validUntil),
    minimumOrder: optionalText(snapshot.minimumOrder, TEXT_BYTES.minimumOrder),
    freightPaise: freight.text,
    commercialTerms: optionalText(
      snapshot.commercialTerms,
      TEXT_BYTES.commercialTerms,
    ),
    notes: optionalText(snapshot.notes, TEXT_BYTES.notes),
    subtotalPaise: subtotal.text,
    gstPaise: gst.text,
    totalPaise: total.text,
    lines,
  };
}

function parseSupplierDocument(value: unknown): AwardSupplierSnapshotsV1 {
  boundedDocument(value, DOCUMENT_LIMITS.awardSupplierSnapshots.jsonBytes);
  const document = storedRecord(value, SUPPLIER_DOCUMENT_KEYS);
  if (document.v !== 1) corrupt();
  const suppliers = denseArray(
    document.suppliers,
    1,
    DOCUMENT_LIMITS.awardSupplierSnapshots.suppliers,
  ).map(parseSupplierSnapshot);
  const supplierIds = new Set<string>();
  const revisions = new Set<string>();
  for (const supplier of suppliers) {
    const revisionIdentity = supplierRevisionIdentity(supplier);
    if (
      supplierIds.has(supplier.supplierId) ||
      revisions.has(revisionIdentity)
    ) {
      corrupt();
    }
    supplierIds.add(supplier.supplierId);
    revisions.add(revisionIdentity);
  }
  return { v: 1, suppliers };
}

function parseDeliveryDocument(value: unknown): AwardDeliverySnapshotV1 {
  boundedDocument(value, DOCUMENT_LIMITS.awardDeliverySnapshot.jsonBytes);
  const document = storedRecord(value, DELIVERY_KEYS);
  if (document.v !== 1) corrupt();
  const delivery = storedRecord(document.deliveryDetails, DELIVERY_DETAILS_KEYS);
  const buyer = storedRecord(document.buyer, BUYER_KEYS);
  return {
    v: 1,
    requestTitle: canonicalText(document.requestTitle, TEXT_BYTES.requestTitle),
    requestedDeliveryDate: dateOnly(document.requestedDeliveryDate),
    deliveryDetails: {
      addressLine: canonicalText(delivery.addressLine, TEXT_BYTES.addressLine),
      city: canonicalText(delivery.city, TEXT_BYTES.place),
      state: canonicalText(delivery.state, TEXT_BYTES.place),
      pin: canonicalText(delivery.pin, TEXT_BYTES.pin),
      instructions: optionalText(delivery.instructions, TEXT_BYTES.instructions),
    },
    commercialTerms: optionalText(
      document.commercialTerms,
      TEXT_BYTES.commercialTerms,
    ),
    buyer: {
      name: canonicalText(buyer.name, TEXT_BYTES.supplierName),
      addressLine: canonicalText(buyer.addressLine, TEXT_BYTES.addressLine),
      city: canonicalText(buyer.city, TEXT_BYTES.place),
      state: canonicalText(buyer.state, TEXT_BYTES.place),
      pin: canonicalText(buyer.pin, TEXT_BYTES.pin),
      phone: canonicalText(buyer.phone, TEXT_BYTES.phone),
      gstin: optionalText(buyer.gstin, TEXT_BYTES.gstin),
    },
  };
}

function allocationIdentity(value: {
  requestItemId: string;
  supplierRequestId: string;
  quoteRevision: number;
}) {
  return `${value.requestItemId}\u0000${value.supplierRequestId}\u0000${value.quoteRevision}`;
}

function supplierRevisionIdentity(value: {
  supplierRequestId: string;
  quoteRevision: number;
}) {
  return `${value.supplierRequestId}\u0000${value.quoteRevision}`;
}

const SPECIFICATION_FIELDS = [
  'v',
  'category',
  'description',
  'preferredBrand',
  'packSize',
  'qualityGrade',
  'notes',
  'referenceUrl',
  'thumbnailWebpBase64',
] as const;

function requestedItemFingerprint(line: AwardDescriptiveLineV1) {
  return JSON.stringify([
    line.itemKey,
    line.itemName,
    line.requestedQuantity,
    line.requestedUnit,
    ...SPECIFICATION_FIELDS.map((field) =>
      Object.prototype.hasOwnProperty.call(line.requestedSpecification, field)
        ? line.requestedSpecification[field]
        : undefined,
    ),
  ]);
}

function scalarTotal(value: unknown) {
  if (typeof value === 'bigint') {
    if (value < BigInt(0) || value > MAX_SIGNED_BIGINT) corrupt();
    return value;
  }
  return canonicalMoney(value).amount;
}

export function validateAwardDocuments(input: {
  allocationLines: unknown;
  supplierSnapshots: unknown;
  deliverySnapshot: unknown;
  totalPaise: unknown;
}) {
  const allocationLines = parseAllocationDocument(input.allocationLines);
  const supplierSnapshots = parseSupplierDocument(input.supplierSnapshots);
  const deliverySnapshot = parseDeliveryDocument(input.deliverySnapshot);
  const storedTotal = scalarTotal(input.totalPaise);

  const supplierByRevision = new Map(
    supplierSnapshots.suppliers.map((supplier) => [
      supplierRevisionIdentity(supplier),
      supplier,
    ]),
  );
  const descriptiveByAllocation = new Map<string, AwardDescriptiveLineV1>();
  const requestedItems = new Map<
    string,
    { fingerprint: string; requestedMilli: bigint }
  >();
  for (const supplier of supplierSnapshots.suppliers) {
    for (const line of supplier.lines) {
      const identity = allocationIdentity({
        requestItemId: line.requestItemId,
        supplierRequestId: supplier.supplierRequestId,
        quoteRevision: supplier.quoteRevision,
      });
      if (descriptiveByAllocation.has(identity)) corrupt();
      descriptiveByAllocation.set(identity, line);
      const fingerprint = requestedItemFingerprint(line);
      const requestedMilli = canonicalQuantity(line.requestedQuantity).milli;
      const previous = requestedItems.get(line.requestItemId);
      if (
        previous &&
        (previous.fingerprint !== fingerprint ||
          previous.requestedMilli !== requestedMilli)
      ) {
        corrupt();
      }
      requestedItems.set(line.requestItemId, { fingerprint, requestedMilli });
    }
  }

  const coverage = new Map<string, bigint>();
  const usedSuppliers = new Set<string>();
  const usedDescriptions = new Set<string>();
  let allocatedGross = BigInt(0);
  for (const line of allocationLines.lines) {
    const supplierIdentity = supplierRevisionIdentity(line);
    const supplier = supplierByRevision.get(supplierIdentity);
    const identity = allocationIdentity(line);
    const description = descriptiveByAllocation.get(identity);
    if (
      !supplier ||
      supplier.supplierId !== line.supplierId ||
      !description ||
      description.requestedUnit !== line.unit
    ) {
      corrupt();
    }
    usedSuppliers.add(supplierIdentity);
    usedDescriptions.add(identity);
    const quantity = canonicalQuantity(line.quantity);
    let totals: ReturnType<typeof calculateGst>;
    try {
      totals = calculateGst({
        amountPaise: multiplyPaise(line.unitRatePaise, line.quantity),
        gstBasisPoints: line.gstBasisPoints,
        inclusive: description.taxInclusive,
      });
      allocatedGross = assertMaximum(
        allocatedGross + totals.grossPaise,
        MAX_SIGNED_BIGINT,
        'Award total',
      );
      coverage.set(
        line.requestItemId,
        assertMaximum(
          (coverage.get(line.requestItemId) ?? BigInt(0)) + quantity.milli,
          MAX_DECIMAL_18_3_SCALED,
          'Award coverage',
        ),
      );
    } catch {
      corrupt();
    }
    if (
      BigInt(line.subtotalPaise) !== totals.netPaise ||
      BigInt(line.gstPaise) !== totals.gstPaise ||
      BigInt(line.totalPaise) !== totals.grossPaise
    ) {
      corrupt();
    }
  }

  if (
    usedSuppliers.size !== supplierSnapshots.suppliers.length ||
    usedDescriptions.size !== descriptiveByAllocation.size ||
    requestedItems.size === 0 ||
    coverage.size !== requestedItems.size
  ) {
    corrupt();
  }
  for (const [requestItemId, requested] of requestedItems) {
    if (coverage.get(requestItemId) !== requested.requestedMilli) corrupt();
  }

  let awardTotal = allocatedGross;
  try {
    for (const supplier of supplierSnapshots.suppliers) {
      awardTotal = assertMaximum(
        awardTotal + BigInt(supplier.freightPaise),
        MAX_SIGNED_BIGINT,
        'Award total',
      );
    }
  } catch {
    corrupt();
  }
  if (awardTotal !== storedTotal) corrupt();

  return {
    allocationLines,
    supplierSnapshots,
    deliverySnapshot,
    totalPaise: awardTotal.toString(),
    splitAward: supplierSnapshots.suppliers.length > 1,
  };
}
