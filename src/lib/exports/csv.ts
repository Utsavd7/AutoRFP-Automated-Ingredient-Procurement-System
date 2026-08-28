export type CsvValue = string | number | bigint | boolean | null | undefined;

const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

function safeCell(value: CsvValue) {
  let text = value === null || value === undefined ? '' : String(value);
  if (text.startsWith("'") || FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeCsv(rows: readonly (readonly CsvValue[])[]) {
  return `\uFEFF${rows.map((row) => row.map(safeCell).join(',')).join('\r\n')}\r\n`;
}

function asciiSlug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

const EXPORT_EXTENSIONS = new Set(['csv', 'pdf', 'png']);

export function safeExportFilename(
  title: string,
  kind: string,
  extension: 'csv' | 'pdf' | 'png',
) {
  if (!EXPORT_EXTENSIONS.has(extension)) {
    throw new TypeError('Unsupported export filename extension.');
  }
  const titleSlug = asciiSlug(title) || 'quoteplate';
  const kindSlug = asciiSlug(kind) || 'export';
  return `${titleSlug}-${kindSlug}.${extension}`;
}

export function safeCsvFilename(title: string, kind: string) {
  return safeExportFilename(title, kind, 'csv');
}
