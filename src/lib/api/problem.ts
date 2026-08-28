import { NextResponse } from 'next/server';

const CORE_PROBLEM_KEYS = new Set(['type', 'status', 'title', 'detail']);
const RESERVED_EXTENSION_KEYS = new Set(['error', 'exception', 'stack', 'toJSON']);
const OMITTED_EXTENSION_VALUE = Symbol('omitted-extension-value');

function sanitizeExtensionRecord(
  value: Record<string, unknown>,
  activeObjects: WeakSet<object>,
  omitCoreKeys = false,
) {
  activeObjects.add(value);

  try {
    const entries: [string, unknown][] = [];

    for (const key of Object.keys(value)) {
      if (RESERVED_EXTENSION_KEYS.has(key) || (omitCoreKeys && CORE_PROBLEM_KEYS.has(key))) continue;

      const sanitizedValue = sanitizeExtensionValue(value[key], activeObjects);
      if (sanitizedValue !== OMITTED_EXTENSION_VALUE) entries.push([key, sanitizedValue]);
    }

    return Object.fromEntries(entries);
  } finally {
    activeObjects.delete(value);
  }
}

function sanitizeExtensionValue(value: unknown, activeObjects: WeakSet<object>): unknown {
  if (typeof value === 'function' || value instanceof Error) return OMITTED_EXTENSION_VALUE;

  if (value instanceof Date) {
    const timestamp = Date.prototype.getTime.call(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  if (!value || typeof value !== 'object') return value;
  if (activeObjects.has(value)) return OMITTED_EXTENSION_VALUE;

  if (Array.isArray(value)) {
    activeObjects.add(value);

    try {
      return value.flatMap((item) => {
        const sanitizedItem = sanitizeExtensionValue(item, activeObjects);
        return sanitizedItem === OMITTED_EXTENSION_VALUE ? [] : [sanitizedItem];
      });
    } finally {
      activeObjects.delete(value);
    }
  }

  return sanitizeExtensionRecord(value as Record<string, unknown>, activeObjects);
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
