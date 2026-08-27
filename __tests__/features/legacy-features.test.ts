import {
  isLegacyFeatureEnabled,
  legacyFeatureUnavailable,
} from '@/lib/features/legacy-features';

describe('legacy feature gate', () => {
  test.each([
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'development', AUTORFP_ENABLE_LEGACY_DEMO: 'false' }, false],
    [{ NODE_ENV: 'development', AUTORFP_ENABLE_LEGACY_DEMO: 'True' }, false],
    [{ NODE_ENV: 'development', AUTORFP_ENABLE_LEGACY_DEMO: 'TRUE' }, false],
    [{ NODE_ENV: 'development', AUTORFP_ENABLE_LEGACY_DEMO: ' true ' }, false],
    [{ NODE_ENV: 'development', AUTORFP_ENABLE_LEGACY_DEMO: 'malformed' }, false],
    [{ NODE_ENV: 'development', AUTORFP_ENABLE_LEGACY_DEMO: 'true' }, true],
    [{ NODE_ENV: 'test', AUTORFP_ENABLE_LEGACY_DEMO: 'true' }, true],
    [{ NODE_ENV: 'production', AUTORFP_ENABLE_LEGACY_DEMO: 'true' }, false],
  ])('fails closed for %o', (env, expected) => {
    expect(isLegacyFeatureEnabled(env)).toBe(expected);
  });

  it('returns a retryable service unavailable problem response', async () => {
    const response = legacyFeatureUnavailable();

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    );
    expect(response.headers.get('retry-after')).toBe('3600');
    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      status: 503,
      title: 'Service unavailable',
      detail: 'This feature is currently unavailable.',
    });
  });
});
