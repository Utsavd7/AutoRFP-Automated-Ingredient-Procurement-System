import { NextResponse } from 'next/server';

const CORE_PROBLEM_KEYS = new Set(['type', 'status', 'title', 'detail']);
const RESERVED_EXTENSION_KEYS = new Set(['error', 'exception', 'stack', 'toJSON']);
const OMITTED_EXTENSION_VALUE = Symbol('omitted-extension-value');

function sanitizeExtensionRecord(
  value: Record<string, unknown>,
  visited: WeakSet<object>,
  omitCoreKeys = false,
) {
  visited.add(value);
  const entries: [string, unknown][] = [];

  for (const key of Object.keys(value)) {
    if (RESERVED_EXTENSION_KEYS.has(key) || (omitCoreKeys && CORE_PROBLEM_KEYS.has(key))) continue;

    const sanitizedValue = sanitizeExtensionValue(value[key], visited);
    if (sanitizedValue !== OMITTED_EXTENSION_VALUE) entries.push([key, sanitizedValue]);
  }

  return Object.fromEntries(entries);
}

function sanitizeExtensionValue(value: unknown, visited: WeakSet<object>): unknown {
  if (typeof value === 'function' || value instanceof Error) return OMITTED_EXTENSION_VALUE;

  if (value instanceof Date) {
    const timestamp = Date.prototype.getTime.call(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  if (!value || typeof value !== 'object') return value;
  if (visited.has(value)) return OMITTED_EXTENSION_VALUE;

  if (Array.isArray(value)) {
    visited.add(value);
    return value.flatMap((item) => {
      const sanitizedItem = sanitizeExtensionValue(item, visited);
      return sanitizedItem === OMITTED_EXTENSION_VALUE ? [] : [sanitizedItem];
    });
  }

  return sanitizeExtensionRecord(value as Record<string, unknown>, visited);
}

export function problemResponse(
  status: number,
  title: string,
  detail: string,
  extensions: Record<string, unknown> = {},
) {
  const safeExtensions = sanitizeExtensionRecord(extensions, new WeakSet(), true);

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
