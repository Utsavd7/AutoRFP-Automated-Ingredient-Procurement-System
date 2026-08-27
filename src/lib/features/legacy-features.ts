import { problemResponse } from '@/lib/api/problem';

type LegacyFeatureEnv = Record<string, string | undefined>;

export function isLegacyFeatureEnabled(
  env: LegacyFeatureEnv = process.env,
): boolean {
  return (
    env.AUTORFP_ENABLE_LEGACY_DEMO === 'true' && env.NODE_ENV !== 'production'
  );
}

export function legacyFeatureUnavailable() {
  const response = problemResponse(
    503,
    'Service unavailable',
    'This feature is currently unavailable.',
  );
  response.headers.set('Retry-After', '3600');
  return response;
}
