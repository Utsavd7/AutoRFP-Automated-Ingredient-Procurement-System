import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sourcePath = (...segments: string[]) =>
  join(process.cwd(), 'src', ...segments);

const readSource = (...segments: string[]) =>
  readFileSync(sourcePath(...segments), 'utf8');

const authenticatedRoutes = ['parse-menu'];

describe('public route surface', () => {
  test.each(authenticatedRoutes)(
    'derives the %s tenant before request-controlled work',
    (route) => {
      const source = readSource('app', 'api', ...route.split('/'), 'route.ts');
      const handlerStart = source.search(/export async function (?:GET|POST)/);
      const handlerSource = source.slice(handlerStart);
      const guardStart = handlerSource.indexOf(
        'const account = await requireAccountContext();',
      );
      const requestBodyStart = handlerSource.indexOf('await req.json()');
      const streamStart = handlerSource.indexOf('new ReadableStream');

      expect(source).toContain(
        "import { requireAccountContext } from '@/lib/server-account';",
      );
      expect(handlerStart).toBeGreaterThanOrEqual(0);
      expect(guardStart).toBeGreaterThanOrEqual(0);
      expect(handlerSource).toContain('if (!account)');
      expect(handlerSource).toContain('account.user.id');
      expect(handlerSource).toContain('account.tenant.id');
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

  it('does not expose a public LLM diagnostics route', () => {
    expect(existsSync(sourcePath('app', 'api', 'debug-llm', 'route.ts'))).toBe(
      false,
    );
  });

  it('keeps the public root static while preserving the real authentication endpoints', () => {
    const source = readSource('app', 'page.tsx');

    expect(source).toContain('<PublicLandingPage');
    expect(source).not.toContain("'use client'");
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('signIn(');
    expect(source).not.toContain('/api/');
    expect(source).not.toMatch(
      /cuisineType|preferredSuppliers|monthlyBudgetTarget|savingsTargetPct|LEGACY_REVIEW_REQUIRED|pin: '000000'/,
    );
    expect(
      existsSync(sourcePath('app', 'api', 'auth', 'start', 'route.ts')),
    ).toBe(true);
    expect(
      existsSync(sourcePath('app', 'api', 'auth', '[...nextauth]', 'route.ts')),
    ).toBe(true);
    expect(
      existsSync(sourcePath('app', 'api', 'auth', 'workspace-check', 'route.ts')),
    ).toBe(false);
  });

  it('closes the mobile drawer before opening command search', () => {
    const source = readSource('app', '(app)', 'layout.tsx');

    expect(source).toMatch(
      /onClick=\{\(\) => \{\s*onNav\(\);\s*window\.dispatchEvent\(new KeyboardEvent/,
    );
  });
});

describe('production-safe workflow presentation', () => {
  it('describes the public launch workflow without prototype promises or fake metrics', () => {
    const landing = [
      readSource('app', 'page.tsx'),
      readSource('components', 'public', 'PublicLandingPage.tsx'),
      readSource('components', 'public', 'SampleQuoteComparison.tsx'),
    ].join('\n');
    const metadata = [
      readSource('app', 'layout.tsx'),
      readSource('config', 'brand.ts'),
    ].join('\n');

    expect(landing).toContain('ingredient requests, supplier responses, landed costs, and award decisions');
    expect(landing).toContain('Sample data');
    expect(landing).toContain('No marketplace or paid messaging service required');
    expect(landing).toContain('Human award required');
    expect(metadata).toContain('review-first procurement workspace');

    for (const staleClaim of [
      'autonomous',
      'Live commodity market pricing',
      'Finds suppliers near your location',
      'Negotiates prices on your behalf',
      'Tracks savings across every run',
      'get quotes in minutes',
      'under 4 minutes',
      'Fully automated',
      'Zero manual work',
      'Procurement AI',
      'Tenant-isolated RLS',
      'Local-first',
      'Open-source stack',
      'LangGraph',
      'Inngest',
      'Groq',
      'Ollama',
      'Sentry',
    ]) {
      expect(landing).not.toContain(staleClaim);
    }
    expect(metadata).not.toMatch(
      /AI-powered|live pricing|supplier discovery|autonomous negotiation/i,
    );
  });

  it('submits only persisted launch account fields and reports accepted saves', () => {
    const source = readSource('app', '(app)', 'settings', 'page.tsx');
    const bodyStart = source.indexOf('body: JSON.stringify({');
    const bodyEnd = source.indexOf('}),', bodyStart);
    const requestBody = source.slice(bodyStart, bodyEnd);
    const responseGuard = source.indexOf('if (!res.ok)');
    const savedState = source.indexOf('setSaved(true)');

    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('readAccount');
    expect(source).not.toContain('saveAccount');
    expect(requestBody).toContain('name');
    expect(requestBody).toContain('email');
    expect(requestBody).toContain('addressLine');
    expect(requestBody).toContain('city');
    expect(requestBody).toContain('state');
    expect(requestBody).toContain('pin');
    expect(requestBody).toContain('phone');
    expect(requestBody).not.toMatch(
      /cuisineType|preferredSuppliers|monthlyBudgetTarget|savingsTargetPct/,
    );
    expect(source).not.toMatch(
      /AI & Data Integrations|Ollama|Groq|Market Data|ChromaDB|LangGraph|Inngest|Sentry/,
    );
    expect(source.slice(responseGuard, savedState)).toContain('throw new Error');
    expect(responseGuard).toBeGreaterThanOrEqual(0);
    expect(savedState).toBeGreaterThan(responseGuard);
  });

  it('offers only currently available actions in the command palette', () => {
    const source = readSource('components', 'CommandPalette.tsx');

    expect(source).toContain("label: 'Create menu draft'");
    expect(source).not.toContain('Run AI Pipeline');
    expect(source).not.toContain('View Quotes');
  });

  it('keeps removed workflow endpoints out of every live UI module', () => {
    const uiSources = [
      readSource('app', 'page.tsx'),
      readSource('app', '(app)', 'dashboard', 'page.tsx'),
      readSource('app', '(app)', 'history', 'page.tsx'),
      readSource('app', '(app)', 'intelligence', 'page.tsx'),
      readSource('app', '(app)', 'procurement', 'page.tsx'),
      readSource('app', '(app)', 'settings', 'page.tsx'),
      readSource('components', 'CommandPalette.tsx'),
    ].join('\n');

    for (const endpoint of [
      '/api/dashboard',
      '/api/history',
      '/api/pricing',
      '/api/distributors',
      '/api/send-rfp',
      '/api/risk-score',
      '/api/simulate-conversation',
      '/api/recommend',
      '/api/agent/negotiate',
    ]) {
      expect(uiSources).not.toContain(endpoint);
    }
  });

  it('uses the launch Prisma client without stale prototype scoping', () => {
    const source = readSource('lib', 'prisma.ts');

    expect(existsSync(sourcePath('lib', 'tenant-context.ts'))).toBe(false);
    expect(source).not.toContain('TENANT_SCOPED');
    expect(source).not.toContain("'RFP'");
    expect(source).not.toContain("'ProcurementRun'");
    expect(source).not.toContain('getCurrentTenantId');
    expect(source).not.toContain('$extends');
  });

  test.each([
    ['dashboard', 'Dashboard'],
    ['history', 'Procurement history'],
    ['intelligence', 'Procurement intelligence'],
  ] as const)('keeps %s as a truthful launch placeholder', (route, title) => {
    const source = readSource('app', '(app)', route, 'page.tsx');

    expect(source).toContain(title);
    expect(source).toContain('Coming in the launch workflow');
    expect(source).toContain('href="/procurement"');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('/api/dashboard');
    expect(source).not.toContain('/api/history');
    expect(source).not.toMatch(/savings|live pricing|AI negotiation|supplier scor/i);
  });

  it('keeps shell account state server-backed and removes false platform claims', () => {
    const source = readSource('app', '(app)', 'layout.tsx');

    expect(source).toMatch(/fetch\(\s*['"]\/api\/account['"](?:\s*,|\s*\))/);
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('readAccount');
    expect(source).not.toContain('saveAccount');
    expect(source).not.toContain('Procurement AI');
    expect(source).not.toContain('AutoRFP Engine');
    expect(source).not.toContain('LangGraph · Inngest · Groq · Sentry');
    expect(source).not.toContain('Tenant-scoped RLS');
  });

  it('removes the legacy browser identity and SHA password authority', () => {
    const source = readSource('lib', 'tenant.ts');

    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('passwordHash');
    expect(source).not.toContain('passwordSalt');
    expect(source).not.toContain('createPasswordRecord');
    expect(source).not.toContain('verifyPassword');
  });

  it('limits procurement to a saved deterministic menu draft', () => {
    const source = readSource('app', '(app)', 'procurement', 'page.tsx');

    expect(source).toContain("fetch('/api/parse-menu'");
    expect(source).toContain('Menu draft saved for review');
    expect(source).toContain(
      'Your menu and extracted dish names are saved; nothing has been sent to suppliers.',
    );
    for (const endpoint of [
      '/api/pricing',
      '/api/distributors',
      '/api/send-rfp',
      '/api/risk-score',
      '/api/simulate-conversation',
      '/api/recommend',
      '/api/agent/negotiate',
    ]) {
      expect(source).not.toContain(endpoint);
    }
    expect(source).not.toContain('AUTORFP_ENABLE_LEGACY_DEMO');
  });

  it('keeps the public quote portal static until launch quote APIs exist', () => {
    const source = readSource('app', 'quote', '[rfpId]', 'page.tsx');

    expect(source).toContain('Supplier quote portal unavailable');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('LegacyQuoteSubmissionPage');
    expect(source).not.toContain('AUTORFP_ENABLE_LEGACY_DEMO');
    expect(source).not.toContain('Submit Official Quote');
  });

  it('labels the documented application tree by its production-safe surface', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('Current production-safe application surface:');
    expect(readme).toContain('Quarantined prototype modules:');
    expect(readme).not.toContain(
      'procurement/page.tsx           New procurement workflow (6-step)',
    );
    expect(readme).not.toContain(
      'quote/[rfpId]/page.tsx           Vendor quote portal',
    );
    expect(readme).not.toContain(
      'pricing/route.ts               Live market pricing (futures + BLS)',
    );
    expect(readme).not.toContain(
      'prisma.ts                        Prisma client with $extends RLS interceptor',
    );
    expect(readme).not.toContain(
      'a saved menu draft, guest-based quantity scaling, and a reviewable ingredient demand draft',
    );
    expect(readme).not.toContain(
      'enter a guest count and buffer, and generate a combined ingredient demand draft',
    );
    expect(readme).not.toContain(
      'The application saves a menu draft and applies deterministic per-guest quantity rules.',
    );
    expect(readme).not.toContain(
      'The flow will stop after it creates the demand draft.',
    );
  });
});
