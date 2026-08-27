import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sourcePath = (...segments: string[]) =>
  join(process.cwd(), 'src', ...segments);

const readSource = (...segments: string[]) =>
  readFileSync(sourcePath(...segments), 'utf8');

describe('public route surface', () => {
  it('does not expose a public LLM diagnostics route', () => {
    expect(existsSync(sourcePath('app', 'api', 'debug-llm', 'route.ts'))).toBe(
      false,
    );
  });

  test.each(['seed-account', 'seed-rag'])(
    'gates the %s demo endpoint before any work begins',
    (route) => {
      const source = readSource('app', 'api', 'demo', route, 'route.ts');

      expect(source).toMatch(
        /export async function POST\([^)]*\)\s*\{\s*if \(!isLegacyFeatureEnabled\(\)\)\s*\{\s*return legacyFeatureUnavailable\(\);\s*\}/,
      );
    },
  );

  it('does not reveal whether a sign-in email has a workspace', () => {
    const source = readSource(
      'app',
      'api',
      'auth',
      'workspace-check',
      'route.ts',
    );
    const signInResponse = source.indexOf("if (mode === 'signin')");
    const tenantLookup = source.indexOf('await prisma.tenant.findFirst');

    expect(source).not.toContain('No workspace exists');
    expect(signInResponse).toBeGreaterThan(-1);
    expect(tenantLookup).toBeGreaterThan(-1);
    expect(signInResponse).toBeLessThan(tenantLookup);
  });
});
