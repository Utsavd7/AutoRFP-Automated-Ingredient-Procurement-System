import { parse } from 'csv-parse/sync';

import {
  type SupplierCreateInput,
  SupplierValidationError,
  validateSupplierCreateInput,
} from '@/lib/suppliers/supplier-schema';

export const SUPPLIER_CSV_HEADERS = [
  'business_name',
  'contact_name',
  'phone',
  'whatsapp_number',
  'email',
  'address_line',
  'city',
  'state',
  'pin',
  'gstin',
  'notes',
  'active',
] as const;

const SUPPLIER_CSV_ROWS = 500;

export const SUPPLIER_CSV_LIMITS = {
  bodyBytes: 1_024 * 1_024,
  rows: SUPPLIER_CSV_ROWS,
  parserRecords: SUPPLIER_CSV_ROWS + 2,
  errorReport: 50,
} as const;

export type SupplierCsvRowError = {
  row: number;
  field: string;
  code: string;
  message: string;
};

export class SupplierCsvError extends Error {
  readonly name = 'SupplierCsvError';

  constructor(
    readonly code: string,
    readonly status: number,
    readonly errors: SupplierCsvRowError[] = [],
    readonly errorCount = errors.length,
  ) {
    super(
      code === 'CSV_BODY_LIMIT'
        ? 'Supplier CSV files must be 1 MB or smaller.'
        : code === 'CSV_ROW_LIMIT'
          ? 'Supplier CSV files may contain at most 500 data rows.'
          : code === 'CSV_MALFORMED'
            ? 'The supplier CSV is malformed or has invalid headers.'
            : 'The supplier CSV contains invalid rows.',
    );
  }
}

export type ParsedSupplierCsvRow = {
  row: number;
  supplier: SupplierCreateInput;
};

type SupplierCsvRecord = {
  record: string[];
  info: { lines: number };
};

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function csvError(row: number, field: string, code: string, message: string) {
  return { row, field, code, message } satisfies SupplierCsvRowError;
}

function malformed(message: string): never {
  throw new SupplierCsvError(
    'CSV_MALFORMED',
    422,
    [csvError(1, 'csv', 'invalid', message)],
    1,
  );
}

function parseActive(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (['true', 'yes', '1', 'active'].includes(normalized)) return true;
  if (['false', 'no', '0', 'inactive'].includes(normalized)) return false;
  return null;
}

function restoreSpreadsheetSafeCell(value: string) {
  if (value.startsWith("''")) return value.slice(1);
  if (value.startsWith("'") && /^\s*[=+\-@]/.test(value.slice(1))) {
    return value.slice(1);
  }
  return value;
}

export function parseSupplierCsv(csv: string): ParsedSupplierCsvRow[] {
  if (utf8Bytes(csv) > SUPPLIER_CSV_LIMITS.bodyBytes) {
    throw new SupplierCsvError('CSV_BODY_LIMIT', 413);
  }

  let records: SupplierCsvRecord[];
  try {
    records = parse(csv, {
      bom: true,
      info: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 100_000,
      to: SUPPLIER_CSV_LIMITS.parserRecords,
    }) as unknown as SupplierCsvRecord[];
  } catch {
    return malformed('Use a valid UTF-8 comma-separated file.');
  }
  const rawHeaders = records[0]?.record;
  if (!rawHeaders || rawHeaders.length === 0) {
    return malformed('Include a header row and at least the business_name column.');
  }
  const headers = rawHeaders.map((value) => value.trim().toLowerCase());
  const allowed = new Set<string>(SUPPLIER_CSV_HEADERS);
  if (
    !headers.includes('business_name') ||
    headers.some((value) => !allowed.has(value)) ||
    new Set(headers).size !== headers.length
  ) {
    return malformed(
      'Headers must be unique supported supplier columns and include business_name.',
    );
  }

  const dataRows = records.slice(1);
  if (dataRows.length > SUPPLIER_CSV_LIMITS.rows) {
    throw new SupplierCsvError('CSV_ROW_LIMIT', 422);
  }
  if (dataRows.length === 0) {
    throw new SupplierCsvError(
      'CSV_INVALID_ROWS',
      422,
      [csvError(2, 'businessName', 'required', 'Add at least one supplier row.')],
      1,
    );
  }

  const parsed: ParsedSupplierCsvRow[] = [];
  const errors: SupplierCsvRowError[] = [];
  let errorCount = 0;
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const pushError = (error: SupplierCsvRowError) => {
    errorCount += 1;
    if (errors.length < SUPPLIER_CSV_LIMITS.errorReport) errors.push(error);
  };

  dataRows.forEach(({ record, info }) => {
    const row = info.lines;
    if (record.length !== headers.length) {
      pushError(
        csvError(
          row,
          'csv',
          'invalid',
          `Expected ${headers.length} columns but received ${record.length}.`,
        ),
      );
      return;
    }

    const raw = Object.fromEntries(
      headers.map((headerName, columnIndex) => [
        headerName,
        restoreSpreadsheetSafeCell(record[columnIndex] ?? ''),
      ]),
    );
    const active = parseActive(raw.active ?? '');
    if (active === null) {
      pushError(
        csvError(row, 'isActive', 'invalid', 'Active must be true, false, yes, or no.'),
      );
    }

    try {
      const supplier = validateSupplierCreateInput({
        businessName: raw.business_name,
        contactName: raw.contact_name,
        phone: raw.phone,
        whatsappNumber: raw.whatsapp_number,
        email: raw.email,
        addressLine: raw.address_line,
        city: raw.city,
        state: raw.state,
        pin: raw.pin,
        gstin: raw.gstin,
        notes: raw.notes,
        ...(active === null ? {} : { isActive: active }),
      });

      if (supplier.email) {
        if (seenEmails.has(supplier.email)) {
          pushError(
            csvError(
              row,
              'email',
              'duplicate',
              'Email is repeated in this file.',
            ),
          );
        } else {
          seenEmails.add(supplier.email);
        }
      }
      if (supplier.phone) {
        if (seenPhones.has(supplier.phone)) {
          pushError(
            csvError(
              row,
              'phone',
              'duplicate',
              'Phone is repeated in this file.',
            ),
          );
        } else {
          seenPhones.add(supplier.phone);
        }
      }
      parsed.push({ row, supplier });
    } catch (error) {
      if (!(error instanceof SupplierValidationError)) throw error;
      for (const [field, messages] of Object.entries(error.errors)) {
        for (const message of messages) {
          pushError(csvError(row, field, 'invalid', message));
        }
      }
    }
  });

  if (errorCount > 0) {
    throw new SupplierCsvError('CSV_INVALID_ROWS', 422, errors, errorCount);
  }
  return parsed;
}

export async function readBoundedSupplierCsv(request: Request): Promise<string> {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > SUPPLIER_CSV_LIMITS.bodyBytes
  ) {
    throw new SupplierCsvError('CSV_BODY_LIMIT', 413);
  }
  if (!request.body) {
    throw new SupplierCsvError(
      'CSV_INVALID_ROWS',
      422,
      [csvError(1, 'csv', 'required', 'Attach a supplier CSV file.')],
      1,
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > SUPPLIER_CSV_LIMITS.bodyBytes) {
        await reader.cancel();
        throw new SupplierCsvError('CSV_BODY_LIMIT', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return malformed('Use a valid UTF-8 comma-separated file.');
  }
}

type SupplierCsvExportRecord = Pick<
  SupplierCreateInput,
  | 'businessName'
  | 'contactName'
  | 'phone'
  | 'whatsappNumber'
  | 'email'
  | 'addressLine'
  | 'city'
  | 'state'
  | 'pin'
  | 'gstin'
  | 'notes'
  | 'isActive'
>;

function escapeCsvCell(value: string | boolean | null) {
  let text = value === null ? '' : String(value);
  if (text.startsWith("'") || /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeSuppliersCsv(
  suppliers: readonly SupplierCsvExportRecord[],
): string {
  const rows = suppliers.map((supplier) =>
    [
      supplier.businessName,
      supplier.contactName,
      supplier.phone,
      supplier.whatsappNumber,
      supplier.email,
      supplier.addressLine,
      supplier.city,
      supplier.state,
      supplier.pin,
      supplier.gstin,
      supplier.notes,
      supplier.isActive,
    ]
      .map(escapeCsvCell)
      .join(','),
  );
  return [SUPPLIER_CSV_HEADERS.map(escapeCsvCell).join(','), ...rows, ''].join(
    '\r\n',
  );
}
