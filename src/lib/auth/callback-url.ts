const protectedRoots = new Set([
  '/dashboard',
  '/procurement',
  '/suppliers',
  '/menus',
  '/insights',
  '/intelligence',
  '/history',
  '/settings',
]);

export function resolveAuthCallback(
  value: string | string[] | null | undefined,
): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return '/dashboard';
  }

  try {
    const parsed = new URL(value, 'https://quoteplate.invalid');
    const root = `/${parsed.pathname.split('/').filter(Boolean)[0] ?? ''}`;
    if (!protectedRoots.has(root)) return '/dashboard';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/dashboard';
  }
}

export function createSignInRedirect(value: string): string {
  return `/signin?callbackUrl=${encodeURIComponent(resolveAuthCallback(value))}`;
}
