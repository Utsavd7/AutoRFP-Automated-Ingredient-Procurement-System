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

  it('returns the same signup preflight response for existing and absent emails', async () => {
    const findFirst = jest.mocked(prisma.tenant.findFirst);
    const payload = {
      mode: 'signup',
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
  });
});
