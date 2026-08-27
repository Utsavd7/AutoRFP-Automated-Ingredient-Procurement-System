import { NextResponse } from 'next/server';

const OMITTED_EXTENSION_KEYS = new Set([
  'type',
  'status',
  'title',
  'detail',
  'error',
  'exception',
  'stack',
]);

export function problemResponse(
  status: number,
  title: string,
  detail: string,
  extensions: Record<string, unknown> = {},
) {
  const safeExtensions = Object.fromEntries(
    Object.entries(extensions).filter(
      ([key, value]) => !OMITTED_EXTENSION_KEYS.has(key) && !(value instanceof Error),
    ),
  );

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
