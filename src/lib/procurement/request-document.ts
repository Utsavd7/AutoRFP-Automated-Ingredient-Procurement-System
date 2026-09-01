import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  type ItemSpecificationV1,
  validateItemSpecification,
} from '@/lib/domain/item-specification';
import { assertBoundedJson } from '@/lib/domain/postgres-json';
import {
  formatQuantity,
  normalizeUnit,
  parseQuantityToMilli,
  type ProcurementUnit,
} from '@/lib/domain/quantity';
import {
  type SupplierLifecycleState,
  SupplierValidationError,
  validateSupplierLifecycleState,
} from '@/lib/suppliers/supplier-schema';

export type SourcingMode = 'CURRENT' | 'SELECTED_NEW' | 'VERIFIED_NEW';

export type SourcingSelectionV1 = {
  v: 1;
  modes: SourcingMode[];
  currentSupplierIds: string[];
  selectedNewSupplierIds: string[];
  acceptVerifiedApplications: boolean;
};

export type RequestItemsV1 = {
  v: 1;
  items: Array<{
    id: string;
    itemKey: string;
    name: string;
    quantity: string;
    unit: ProcurementUnit;
    specification: ItemSpecificationV1;
    sourcingOverride: SourcingSelectionV1 | null;
  }>;
};

export type RequestSourcingV1 = {
  v: 1;
  default: SourcingSelectionV1;
};

export type ExplicitRequestSupplier = SupplierLifecycleState & { id: string };

export type SourcingSupplierChoice = {
  id: string;
  relationshipType: 'CURRENT' | 'SELECTED_NEW';
};

const ITEM_DOCUMENT_KEYS = new Set(['v', 'items']);
const ITEM_KEYS = new Set([
  'id',
  'itemKey',
  'name',
  'quantity',
  'unit',
  'specification',
  'sourcingOverride',
]);
const SOURCING_DOCUMENT_KEYS = new Set(['v', 'default']);
const SELECTION_KEYS = new Set([
  'v',
  'modes',
  'currentSupplierIds',
  'selectedNewSupplierIds',
  'acceptVerifiedApplications',
]);
const MODE_ORDER = ['CURRENT', 'SELECTED_NEW', 'VERIFIED_NEW'] as const;
const MODE_SET = new Set<string>(MODE_ORDER);

const LIMITS = {
  itemIdBytes: 32,
  itemKeyBytes: 80,
  itemNameBytes: 160,
  supplierIdBytes: 200,
} as const;

export class RequestDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestDocumentValidationError';
  }
}

function fail(message: string): never {
  throw new RequestDocumentValidationError(message);
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function plainRecord(
  input: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    fail(`${label} must be a plain JSON object.`);
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      fail(`${label} contains unknown key ${String(key)}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail(`${label} key ${key} must be an enumerable data property.`);
    }
  }
  return input as Record<string, unknown>;
}

function boundedCanonicalText(
  value: unknown,
  label: string,
  maximumBytes: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    byteLength(value) > maximumBytes
  ) {
    fail(`${label} must be canonical text of ${maximumBytes} UTF-8 bytes or fewer.`);
  }
  return value;
}

function itemId(value: unknown, label: string): string {
  const id = boundedCanonicalText(value, label, LIMITS.itemIdBytes);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    fail(`${label} must be a short document-scoped ID.`);
  }
  return id;
}

function itemKey(value: unknown, label: string): string {
  const key = boundedCanonicalText(value, label, LIMITS.itemKeyBytes);
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(key)) {
    fail(`${label} must be a stable lowercase item key.`);
  }
  return key;
}

function supplierId(value: unknown, label: string): string {
  return boundedCanonicalText(value, label, LIMITS.supplierIdBytes);
}

function boundedPlainArray(
  value: unknown,
  label: string,
  maximum: number,
): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  ) {
    fail(`${label} must be an array with at most ${maximum} entries.`);
  }
  return value;
}

function parseSupplierIds(value: unknown, label: string): string[] {
  const ids = boundedPlainArray(
    value,
    label,
    DOCUMENT_LIMITS.selectedSuppliers,
  ).map((entry, index) => supplierId(entry, `${label} ${index + 1}`));
  if (new Set(ids).size !== ids.length) {
    fail(`${label} must not contain duplicate supplier IDs.`);
  }
  return ids;
}

function parseSelection(input: unknown, label: string): SourcingSelectionV1 {
  const selection = plainRecord(input, label, SELECTION_KEYS);
  if (selection.v !== 1) fail(`${label} version must be 1.`);
  if (
    !Array.isArray(selection.modes) ||
    Object.getPrototypeOf(selection.modes) !== Array.prototype ||
    selection.modes.length === 0 ||
    selection.modes.length > MODE_ORDER.length ||
    selection.modes.some((mode) => typeof mode !== 'string' || !MODE_SET.has(mode)) ||
    new Set(selection.modes).size !== selection.modes.length
  ) {
    fail(`${label} modes must be a unique nonempty subset of the supported modes.`);
  }
  const rawModes = selection.modes as string[];
  const modes = MODE_ORDER.filter((mode) => rawModes.includes(mode));
  const currentSupplierIds = parseSupplierIds(
    selection.currentSupplierIds,
    `${label} currentSupplierIds`,
  );
  const selectedNewSupplierIds = parseSupplierIds(
    selection.selectedNewSupplierIds,
    `${label} selectedNewSupplierIds`,
  );
  if (
    currentSupplierIds.length > 0 &&
    !modes.includes('CURRENT')
  ) {
    fail(`${label} cannot select current suppliers without CURRENT mode.`);
  }
  if (
    selectedNewSupplierIds.length > 0 &&
    !modes.includes('SELECTED_NEW')
  ) {
    fail(`${label} cannot select new suppliers without SELECTED_NEW mode.`);
  }
  const allIds = [...currentSupplierIds, ...selectedNewSupplierIds];
  if (new Set(allIds).size !== allIds.length) {
    fail(`${label} cannot assign one supplier to two relationship modes.`);
  }
  if (typeof selection.acceptVerifiedApplications !== 'boolean') {
    fail(`${label} acceptVerifiedApplications must be boolean.`);
  }
  return {
    v: 1,
    modes,
    currentSupplierIds,
    selectedNewSupplierIds,
    acceptVerifiedApplications: selection.acceptVerifiedApplications,
  };
}

function decodedBase64Bytes(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function boundedDocument(
  input: unknown,
  maximumBytes: number,
  label: string,
) {
  try {
    assertBoundedJson(input, maximumBytes, label);
  } catch (error) {
    if (error instanceof RangeError) {
      fail(`${label} exceeds its ${maximumBytes / 1024} KiB JSON limit.`);
    }
    if (error instanceof TypeError) fail(`${label} must contain only valid JSON.`);
    throw error;
  }
}

export function validateRequestItems(input: unknown): RequestItemsV1 {
  boundedDocument(
    input,
    DOCUMENT_LIMITS.requestItems.jsonBytes,
    'Request items document',
  );
  const root = plainRecord(input, 'Request items document', ITEM_DOCUMENT_KEYS);
  if (root.v !== 1) fail('Request items document version must be 1.');
  const rawItems = boundedPlainArray(
    root.items,
    'Request items',
    DOCUMENT_LIMITS.requestItems.items,
  );
  if (rawItems.length === 0) fail('Request items must contain at least one item.');

  const ids = new Set<string>();
  let thumbnailCount = 0;
  let thumbnailBytes = 0;
  const items = rawItems.map((value, index) => {
    const label = `Request item ${index + 1}`;
    const entry = plainRecord(value, label, ITEM_KEYS);
    const id = itemId(entry.id, `${label} id`);
    if (ids.has(id)) fail('Request item IDs must be unique within the document.');
    ids.add(id);
    const normalizedItemKey = itemKey(entry.itemKey, `${label} itemKey`);
    const name = boundedCanonicalText(
      entry.name,
      `${label} name`,
      LIMITS.itemNameBytes,
    );
    if (typeof entry.quantity !== 'string') {
      fail(`${label} quantity must be an exact decimal string.`);
    }
    let quantity: string;
    let unit: ProcurementUnit;
    let specification: ItemSpecificationV1;
    try {
      quantity = formatQuantity(parseQuantityToMilli(entry.quantity));
    } catch {
      fail(`${label} quantity must be a positive exact decimal with at most three places.`);
    }
    try {
      unit = normalizeUnit(entry.unit as string);
    } catch {
      fail(`${label} unit is not supported.`);
    }
    try {
      specification = validateItemSpecification(entry.specification);
    } catch (error) {
      fail(
        `${label} specification is invalid: ${
          error instanceof Error ? error.message : 'invalid specification'
        }`,
      );
    }
    const thumbnail = specification.thumbnailWebpBase64;
    if (typeof thumbnail === 'string') {
      thumbnailCount += 1;
      thumbnailBytes += decodedBase64Bytes(thumbnail);
      if (thumbnailCount > DOCUMENT_LIMITS.thumbnails.perDocument) {
        fail(
          `Request item documents may contain at most ${DOCUMENT_LIMITS.thumbnails.perDocument} thumbnails.`,
        );
      }
      if (thumbnailBytes > DOCUMENT_LIMITS.thumbnails.decodedBytesPerDocument) {
        fail('Request item document thumbnails exceed the total decoded-byte limit.');
      }
    }
    const sourcingOverride = entry.sourcingOverride === null
      ? null
      : parseSelection(entry.sourcingOverride, `${label} sourcingOverride`);
    return {
      id,
      itemKey: normalizedItemKey,
      name,
      quantity,
      unit,
      specification,
      sourcingOverride,
    };
  });

  const document: RequestItemsV1 = { v: 1, items };
  boundedDocument(
    document,
    DOCUMENT_LIMITS.requestItems.jsonBytes,
    'Request items document',
  );
  return document;
}

export function validateRequestSourcing(input: unknown): RequestSourcingV1 {
  boundedDocument(
    input,
    DOCUMENT_LIMITS.requestSourcing.jsonBytes,
    'Request sourcing document',
  );
  const root = plainRecord(
    input,
    'Request sourcing document',
    SOURCING_DOCUMENT_KEYS,
  );
  if (root.v !== 1) fail('Request sourcing document version must be 1.');
  const document: RequestSourcingV1 = {
    v: 1,
    default: parseSelection(root.default, 'Default sourcing selection'),
  };
  boundedDocument(
    document,
    DOCUMENT_LIMITS.requestSourcing.jsonBytes,
    'Request sourcing document',
  );
  return document;
}

export function resolveItemSourcing(
  sourcing: RequestSourcingV1,
  override: SourcingSelectionV1 | null,
): SourcingSelectionV1 {
  return override ?? sourcing.default;
}

export function buildDefaultSourcingSelection(
  suppliers: readonly SourcingSupplierChoice[],
  selectedSupplierIds: readonly string[],
  acceptVerifiedApplications: boolean,
): SourcingSelectionV1 {
  const selected = new Set(selectedSupplierIds);
  const currentSupplierIds = suppliers
    .filter(({ id, relationshipType }) => selected.has(id) && relationshipType === 'CURRENT')
    .map(({ id }) => id);
  const selectedNewSupplierIds = suppliers
    .filter(({ id, relationshipType }) => selected.has(id) && relationshipType === 'SELECTED_NEW')
    .map(({ id }) => id);
  const modes: SourcingMode[] = [];
  if (currentSupplierIds.length > 0) modes.push('CURRENT');
  if (selectedNewSupplierIds.length > 0) modes.push('SELECTED_NEW');
  if (acceptVerifiedApplications) modes.push('VERIFIED_NEW');
  return {
    v: 1,
    modes,
    currentSupplierIds,
    selectedNewSupplierIds,
    acceptVerifiedApplications,
  };
}

function selectionAcceptsVerifiedApplications(selection: SourcingSelectionV1) {
  return selection.acceptVerifiedApplications &&
    selection.modes.includes('VERIFIED_NEW');
}

export function requestAcceptsVerifiedApplications(
  items: RequestItemsV1,
  sourcing: RequestSourcingV1,
) {
  return items.items.some((item) =>
    selectionAcceptsVerifiedApplications(
      resolveItemSourcing(sourcing, item.sourcingOverride),
    ));
}

function expectedSupplierRelationships(
  items: RequestItemsV1,
  sourcing: RequestSourcingV1,
) {
  const expected = new Map<string, 'CURRENT' | 'SELECTED_NEW'>();
  const add = (
    selection: SourcingSelectionV1,
    relationshipType: 'CURRENT' | 'SELECTED_NEW',
  ) => {
    const ids = relationshipType === 'CURRENT'
      ? selection.currentSupplierIds
      : selection.selectedNewSupplierIds;
    for (const id of ids) {
      const previous = expected.get(id);
      if (previous && previous !== relationshipType) {
        fail('One supplier cannot be selected as both CURRENT and SELECTED_NEW.');
      }
      expected.set(id, relationshipType);
    }
  };
  const selections = items.items.map((item) =>
    resolveItemSourcing(sourcing, item.sourcingOverride),
  );
  for (const selection of selections) {
    add(selection, 'CURRENT');
    add(selection, 'SELECTED_NEW');
  }
  return expected;
}

export function collectExplicitSupplierIds(
  items: RequestItemsV1,
  sourcing: RequestSourcingV1,
): string[] {
  return [...expectedSupplierRelationships(items, sourcing).keys()];
}

export function validateRequestDocuments(
  itemsInput: unknown,
  sourcingInput: unknown,
) {
  const items = validateRequestItems(itemsInput);
  const sourcing = validateRequestSourcing(sourcingInput);
  const explicitSupplierIds = collectExplicitSupplierIds(items, sourcing);
  if (explicitSupplierIds.length > DOCUMENT_LIMITS.selectedSuppliers) {
    fail(
      `Request sourcing may explicitly select at most ${DOCUMENT_LIMITS.selectedSuppliers} unique suppliers.`,
    );
  }
  for (const item of items.items) {
    const effective = resolveItemSourcing(sourcing, item.sourcingOverride);
    if (
      effective.currentSupplierIds.length === 0 &&
      effective.selectedNewSupplierIds.length === 0 &&
      !selectionAcceptsVerifiedApplications(effective)
    ) {
      fail(`Request item ${item.id} has no usable effective sourcing selection.`);
    }
  }
  return { items, sourcing, explicitSupplierIds };
}

export function validateExplicitRequestSuppliers(
  itemsInput: unknown,
  sourcingInput: unknown,
  suppliers: ExplicitRequestSupplier[],
) {
  const { items, sourcing, explicitSupplierIds } = validateRequestDocuments(
    itemsInput,
    sourcingInput,
  );
  const expected = expectedSupplierRelationships(items, sourcing);
  if (
    !Array.isArray(suppliers) ||
    suppliers.length !== explicitSupplierIds.length ||
    new Set(suppliers.map(({ id }) => id)).size !== suppliers.length
  ) {
    fail('Every explicitly selected supplier must exist in this tenant.');
  }
  for (const supplier of suppliers) {
    try {
      validateSupplierLifecycleState({
        relationshipType: supplier.relationshipType,
        verificationStatus: supplier.verificationStatus,
        applicationRequestId: supplier.applicationRequestId,
        verifiedAt: supplier.verifiedAt,
        verifiedByUserId: supplier.verifiedByUserId,
        isActive: supplier.isActive,
      });
    } catch (error) {
      if (!(error instanceof SupplierValidationError)) throw error;
      fail(`Supplier ${supplier.id} has an invalid verification lifecycle.`);
    }
    if (
      !supplier.isActive ||
      supplier.verificationStatus !== 'VERIFIED' ||
      expected.get(supplier.id) !== supplier.relationshipType
    ) {
      fail(`Supplier ${supplier.id} is not eligible for its selected sourcing mode.`);
    }
  }
  return { items, sourcing, explicitSupplierIds };
}
