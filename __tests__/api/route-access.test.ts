import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/lib/prisma';
import { POST as checkWorkspace } from '@/app/api/auth/workspace-check/route';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: {
      findFirst: jest.fn(),
    },
  },
}));

const sourcePath = (...segments: string[]) =>
  join(process.cwd(), 'src', ...segments);

const readSource = (...segments: string[]) =>
  readFileSync(sourcePath(...segments), 'utf8');

const authenticatedRoutes = [
  'parse-menu',
  'quotes',
  'pricing',
  'distributors',
  'risk-score',
  'ml/forecast',
  'send-rfp',
  'simulate-conversation',
  'recommend',
  'agent/negotiate',
  'webhooks/inbound-email',
];

const quarantinedAuthenticatedRoutes = [
  'pricing',
  'distributors',
  'risk-score',
  'ml/forecast',
  'send-rfp',
  'simulate-conversation',
  'recommend',
  'agent/negotiate',
  'webhooks/inbound-email',
];

const legacyGateImport =
  "import { isLegacyFeatureEnabled, legacyFeatureUnavailable } from '@/lib/features/legacy-features';";

const authenticatedLegacyGate =
  /export async function (?:GET|POST)\([^)]*\)\s*\{\s*const access = await requireApiTenant\(\);\s*if \(access\.response\) return access\.response;\s*if \(!isLegacyFeatureEnabled\(\)\)\s*\{\s*return legacyFeatureUnavailable\(\);\s*\}/;

const publicLegacyGate = (method: 'GET' | 'POST') =>
  new RegExp(
    `export async function ${method}\\([\\s\\S]*?\\)\\s*\\{\\s*if \\(!isLegacyFeatureEnabled\\(\\)\\)\\s*\\{\\s*return legacyFeatureUnavailable\\(\\);\\s*\\}`,
  );

describe('public route surface', () => {
  test.each(authenticatedRoutes)(
    'derives the %s tenant before request-controlled work',
    (route) => {
      const source = readSource('app', 'api', ...route.split('/'), 'route.ts');
      const handlerStart = source.search(/export async function (?:GET|POST)/);
      const handlerSource = source.slice(handlerStart);
      const guardStart = handlerSource.indexOf(
        'const access = await requireApiTenant();',
      );
      const requestBodyStart = handlerSource.indexOf('await req.json()');
      const streamStart = handlerSource.indexOf('new ReadableStream');

      expect(source).toContain(
        "import { requireApiTenant } from '@/lib/api/require-api-tenant';",
      );
      expect(handlerStart).toBeGreaterThanOrEqual(0);
      expect(guardStart).toBeGreaterThanOrEqual(0);
      expect(handlerSource).toContain('if (access.response) return access.response;');
      if (requestBodyStart >= 0) expect(guardStart).toBeLessThan(requestBodyStart);
      if (streamStart >= 0) expect(guardStart).toBeLessThan(streamStart);
      expect(handlerSource).not.toMatch(
        /searchParams\.get\((['"])tenantId\1\)/,
      );
      expect(handlerSource).not.toMatch(
        /const\s*\{[\s\S]*?\btenantId\b[\s\S]*?\}\s*=\s*await req\.json\(\)/,
      );
    },
  );

  test.each(quarantinedAuthenticatedRoutes)(
    'gates the authenticated %s workflow immediately after authentication',
    (route) => {
      const source = readSource('app', 'api', ...route.split('/'), 'route.ts');

      expect(source).toContain(legacyGateImport);
      expect(source).toMatch(authenticatedLegacyGate);
    },
  );

  test.each(['GET', 'POST'] as const)(
    'gates the public quote %s handler before request or database work',
    (method) => {
      const source = readSource('app', 'api', 'quote', '[rfpId]', 'route.ts');

      expect(source).toContain(legacyGateImport);
      expect(source).toMatch(publicLegacyGate(method));
    },
  );

  test.each(['GET', 'POST', 'PUT'] as const)(
    'gates the Inngest %s handler before invoking Inngest',
    (method) => {
      const source = readSource('app', 'api', 'inngest', 'route.ts');
      const handlerGate = new RegExp(
        `export const ${method}[^=]*=\\s*\\([^)]*\\)\\s*=>\\s*\\{\\s*if \\(!isLegacyFeatureEnabled\\(\\)\\)\\s*\\{\\s*return legacyFeatureUnavailable\\(\\);\\s*\\}`,
      );

      expect(source).toContain(legacyGateImport);
      expect(source).toMatch(handlerGate);
    },
  );

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

  it('does not query account existence during workspace preflight', () => {
    const source = readSource(
      'app',
      'api',
      'auth',
      'workspace-check',
      'route.ts',
    );

    expect(source).not.toContain('No workspace exists');
    expect(source).not.toContain('A workspace already exists');
    expect(source).not.toContain('prisma');
  });

  test.each(['signin', 'signup'] as const)(
    'returns the same %s preflight response for existing and absent emails',
    async (mode) => {
      const findFirst = jest.mocked(prisma.tenant.findFirst);
      const payload = {
        mode,
        name: 'Test Restaurant',
        email: 'owner@example.com',
        password: 'valid-password',
        location: 'Mumbai',
        cuisineType: 'Indian',
      };

      findFirst.mockResolvedValueOnce(null);
      const absentResponse = await checkWorkspace(
        new Request('http://localhost/api/auth/workspace-check', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      );

      findFirst.mockResolvedValueOnce({ id: 'existing' } as never);
      const existingResponse = await checkWorkspace(
        new Request('http://localhost/api/auth/workspace-check', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      );

      expect(existingResponse.status).toBe(absentResponse.status);
      await expect(existingResponse.json()).resolves.toEqual(
        await absentResponse.json(),
      );
    },
  );

  it('guards malformed analyst output before reading vendor analysis', () => {
    const source = readSource('app', 'api', 'agent', 'negotiate', 'route.ts');
    const guardStart = source.indexOf(
      'Array.isArray(marketAnalysis.vendorAnalysis)',
    );
    const lookupStart = source.indexOf('marketAnalysis.vendorAnalysis.find');

    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(guardStart).toBeLessThan(lookupStart);
  });

  it('closes the mobile drawer before opening command search', () => {
    const source = readSource('app', '(app)', 'layout.tsx');

    expect(source).toMatch(
      /onClick=\{\(\) => \{\s*onNav\(\);\s*window\.dispatchEvent\(new KeyboardEvent/,
    );
  });
});
