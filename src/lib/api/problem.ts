import { NextResponse } from 'next/server';

const CORE_PROBLEM_KEYS = new Set(['type', 'status', 'title', 'detail']);
const INTERNAL_ERROR_KEYS = new Set(['error', 'exception', 'stack']);
const OMITTED_EXTENSION_VALUE = Symbol('omitted-extension-value');

function sanitizeExtensionRecord(value: Record<string, unknown>, omitCoreKeys = false) {
  const entries: [string, unknown][] = [];

  for (const [key, nestedValue] of Object.entries(value)) {
    if (INTERNAL_ERROR_KEYS.has(key) || (omitCoreKeys && CORE_PROBLEM_KEYS.has(key))) continue;

    const sanitizedValue = sanitizeExtensionValue(nestedValue);
    if (sanitizedValue !== OMITTED_EXTENSION_VALUE) entries.push([key, sanitizedValue]);
  }

  return Object.fromEntries(entries);
}

function sanitizeExtensionValue(value: unknown): unknown {
  if (value instanceof Error) return OMITTED_EXTENSION_VALUE;

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitizedItem = sanitizeExtensionValue(item);
      return sanitizedItem === OMITTED_EXTENSION_VALUE ? [] : [sanitizedItem];
    });
  }

  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    return sanitizeExtensionRecord(value as Record<string, unknown>);
  }

  return value;
}

export function problemResponse(
  status: number,
  title: string,
  detail: string,
  extensions: Record<string, unknown> = {},
) {
  const safeExtensions = sanitizeExtensionRecord(extensions, true);

  return NextResponse.json(
    {
      type: 'about:blank',
      status,
      title,
      detail,
      ...safeExtensions,
    },
    {
      status,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  );
}
