import type { MenuDocumentV1 } from '@/lib/menu/menu-document';

export const MENU_TEXT_BYTES = 100_000;
export const OCR_LINE_LIMIT = 2_000;
export const OCR_LINE_BYTES = 500;

const OCR_DOCUMENT_KINDS = new Set([
  'PRINTED',
  'HANDWRITING_BEST_EFFORT',
  'QUOTE',
  'INVOICE',
  'RECEIPT',
  'MENU',
  'BUYING_LIST',
]);
const INPUT_KEYS = new Set(['menuText', 'source']);
const OCR_SOURCE_KEYS = new Set(['kind', 'documentKind', 'lines']);
const OCR_LINE_KEYS = new Set(['text', 'confidence']);
const URL_SOURCE_KEYS = new Set([
  'kind',
  'canonicalUrl',
  'permissionConfirmed',
]);

type MenuInputErrors = Record<string, string[]>;

export type MenuInputResult =
  | {
      ok: true;
      value: {
        menuText: string;
        source?: MenuDocumentV1['source'];
      };
    }
  | { ok: false; errors: MenuInputErrors };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function addError(errors: MenuInputErrors, path: string, message: string) {
  (errors[path] ??= []).push(message);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  errors: MenuInputErrors,
  path = '',
) {
  for (const key of Reflect.ownKeys(value)) {
    const field = path ? `${path}.${String(key)}` : String(key);
    if (typeof key !== 'string' || !allowed.has(key)) {
      addError(errors, field, 'This field is not allowed.');
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      addError(errors, field, 'This field must be an enumerable data property.');
    }
  }
}

function isUrlLike(value: string) {
  return /^(?:(?:data|blob|file):|[a-z][a-z\d+.-]*:\/\/|\/\/|www\.)\S+/i
    .test(value.trim());
}

function canonicalPermittedUrl(value: unknown, errors: MenuInputErrors) {
  if (typeof value !== 'string' || !value || value.length > 2_048) {
    addError(errors, 'source.canonicalUrl', 'Use a bounded HTTPS menu URL.');
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.toString() !== value
    ) {
      throw new TypeError();
    }
    return value;
  } catch {
    addError(
      errors,
      'source.canonicalUrl',
      'Use a canonical HTTPS menu URL without credentials, tracking details, or a fragment.',
    );
    return null;
  }
}

function parseOcrSource(
  source: Record<string, unknown>,
  menuText: string,
  errors: MenuInputErrors,
): MenuDocumentV1['source'] | null {
  rejectUnknownKeys(source, OCR_SOURCE_KEYS, errors, 'source');
  if (
    typeof source.documentKind !== 'string' ||
    !OCR_DOCUMENT_KINDS.has(source.documentKind)
  ) {
    addError(errors, 'source.documentKind', 'Choose a supported document type.');
  }
  if (
    !Array.isArray(source.lines) ||
    Object.getPrototypeOf(source.lines) !== Array.prototype ||
    source.lines.length === 0 ||
    source.lines.length > OCR_LINE_LIMIT
  ) {
    addError(
      errors,
      'source.lines',
      `Provide between 1 and ${OCR_LINE_LIMIT.toLocaleString('en-IN')} reviewed OCR lines.`,
    );
    return null;
  }
  const lines: string[] = [];
  source.lines.forEach((value, index) => {
    const path = `source.lines.${index}`;
    if (!isRecord(value)) {
      addError(errors, path, 'Each OCR line must contain text and confidence.');
      return;
    }
    rejectUnknownKeys(value, OCR_LINE_KEYS, errors, path);
    if (
      typeof value.text !== 'string' ||
      !value.text ||
      value.text.trim() !== value.text ||
      byteLength(value.text) > OCR_LINE_BYTES ||
      /[\u0000-\u001f\u007f]/.test(value.text)
    ) {
      addError(
        errors,
        `${path}.text`,
        `OCR line text must be ${OCR_LINE_BYTES} UTF-8 bytes or fewer.`,
      );
    } else {
      lines.push(value.text);
    }
    if (
      typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1
    ) {
      addError(errors, `${path}.confidence`, 'OCR confidence must be from 0 to 1.');
    }
  });
  if (lines.length === source.lines.length && lines.join('\n') !== menuText) {
    addError(
      errors,
      'source.lines',
      'Reviewed OCR lines must match the menu text being saved.',
    );
  }
  return { kind: 'OCR', canonicalUrl: null, permissionConfirmed: false };
}

function parseSource(
  value: unknown,
  menuText: string,
  errors: MenuInputErrors,
): MenuDocumentV1['source'] | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    addError(errors, 'source', 'Menu source details must be a JSON object.');
    return null;
  }
  if (value.kind === 'OCR') return parseOcrSource(value, menuText, errors);
  if (value.kind === 'PERMITTED_URL') {
    rejectUnknownKeys(value, URL_SOURCE_KEYS, errors, 'source');
    const canonicalUrl = canonicalPermittedUrl(value.canonicalUrl, errors);
    if (value.permissionConfirmed !== true) {
      addError(
        errors,
        'source.permissionConfirmed',
        'Confirm that you have permission to import this menu.',
      );
    }
    return canonicalUrl
      ? { kind: 'PERMITTED_URL', canonicalUrl, permissionConfirmed: true }
      : null;
  }
  addError(errors, 'source.kind', 'Choose OCR or a permitted URL source.');
  return null;
}

export function parseMenuInput(body: unknown): MenuInputResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      errors: { body: ['Expected a JSON object.'] },
    };
  }

  const errors: MenuInputErrors = {};
  rejectUnknownKeys(body, INPUT_KEYS, errors);
  const menuText = body.menuText;
  let normalizedMenuText = '';
  if (typeof menuText !== 'string' || !menuText.trim()) {
    errors.menuText = ['Menu text is required.'];
  } else {
    normalizedMenuText = menuText.trim();
    if (isUrlLike(normalizedMenuText)) {
      errors.menuText = ['URLs are not accepted here. Use the permitted URL option.'];
    } else if (byteLength(normalizedMenuText) > MENU_TEXT_BYTES) {
      errors.menuText = ['Menu text must be 100,000 UTF-8 bytes or fewer.'];
    } else if (normalizedMenuText.includes('\u0000')) {
      errors.menuText = ['Menu text contains an unsupported character.'];
    }
  }
  const source = parseSource(body.source, normalizedMenuText, errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      menuText: normalizedMenuText,
      ...(source ? { source } : {}),
    },
  };
}
