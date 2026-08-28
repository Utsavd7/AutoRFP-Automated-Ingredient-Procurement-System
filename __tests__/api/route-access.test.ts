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

  it('closes the mobile drawer when navigating and supports an accessible escape action', () => {
    const source = readSource('app', '(app)', 'layout.tsx');

    expect(source).toContain('onClick={onNav}');
    expect(source).toContain("if (event.key === 'Escape') setMobileOpen(false)");
    expect(source).toContain('aria-label="Open navigation"');
    expect(source).toContain('aria-label="Close navigation"');
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
    const source = readSource('components', 'settings', 'SettingsWorkspace.tsx');
    const saveStart = source.indexOf('async function save');
    const saveEnd = source.indexOf('async function confirmAction', saveStart);
    const saveFlow = source.slice(saveStart, saveEnd);
    const responseGuard = saveFlow.indexOf('if (!response.ok)');
    const savedState = saveFlow.indexOf('setSaved(true)');

    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('readAccount');
    expect(source).not.toContain('saveAccount');
    expect(saveFlow).toContain("fetch('/api/settings'");
    expect(saveFlow).toContain("method: 'PATCH'");
    expect(saveFlow).toContain('body: JSON.stringify({ details: form })');
    expect(source).toContain("setField('name'");
    expect(source).not.toContain("setField('contactEmail'");
    expect(source).toContain("setField('addressLine'");
    expect(source).toContain("setField('city'");
    expect(source).toContain("setField('state'");
    expect(source).toContain("setField('pin'");
    expect(source).toContain("setField('phone'");
    expect(source).toContain("setField('gstin'");
    expect(saveFlow).not.toMatch(
      /cuisineType|preferredSuppliers|monthlyBudgetTarget|savingsTargetPct/,
    );
    expect(source).not.toMatch(
      /AI & Data Integrations|Ollama|Groq|Market Data|ChromaDB|LangGraph|Inngest|Sentry/,
    );
    expect(saveFlow.slice(responseGuard, savedState)).toContain('throw new Error');
    expect(responseGuard).toBeGreaterThanOrEqual(0);
    expect(savedState).toBeGreaterThan(responseGuard);
  });

  it('keeps removed workflow endpoints out of every live UI module', () => {
    const uiSources = [
      readSource('app', 'page.tsx'),
      readSource('app', '(app)', 'dashboard', 'page.tsx'),
      readSource('app', '(app)', 'history', 'page.tsx'),
      readSource('app', '(app)', 'intelligence', 'page.tsx'),
      readSource('app', '(app)', 'procurement', 'page.tsx'),
      readSource('app', '(app)', 'settings', 'page.tsx'),
    ].join('\n');

    for (const endpoint of [
      '/api/dashboard',
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

  it('connects overview, history, and insights to factual launch workspaces', () => {
    const dashboard = readSource('app', '(app)', 'dashboard', 'page.tsx');
    const history = readSource('app', '(app)', 'history', 'page.tsx');
    const intelligence = readSource('app', '(app)', 'intelligence', 'page.tsx');
    const insights = readSource('components', 'reporting', 'InsightsWorkspace.tsx');

    expect(dashboard).toContain('<OverviewWorkspace');
    expect(history).toContain('<HistoryWorkspace');
    expect(intelligence).toContain("redirect('/insights')");
    expect(insights).toContain("fetch('/api/insights'");
    expect(insights).toContain('Submitted facts only');
    expect([dashboard, history, intelligence, insights].join('\n')).not.toContain('Coming in the launch workflow');
    expect([dashboard, history, intelligence, insights].join('\n')).not.toContain('localStorage');
    expect(insights).not.toMatch(/guaranteed savings|live pricing|AI negotiation|supplier score/i);
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

  it('connects procurement to reviewed menus and real request APIs only', () => {
    const source = [
      readSource('app', '(app)', 'procurement', 'page.tsx'),
      readSource('components', 'procurement', 'ProcurementWorkspace.tsx'),
      readSource('components', 'procurement', 'NewRequestForm.tsx'),
    ].join('\n');

    expect(source).toContain("new URLSearchParams({ limit: '50' })");
    expect(source).toContain('fetch(`/api/requests?${params}`');
    expect(source).toContain("fetch('/api/menus?limit=50'");
    expect(source).toContain("fetch('/api/suppliers?active=true&limit=50'");
    expect(source).toContain('Nothing is shared yet');
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

  it('keeps supplier entry on the fragment-authorized quote route', () => {
    const page = readSource('app', 'quote', 'page.tsx');
    const accessClient = readSource('app', 'quote', 'QuoteAccessClient.tsx');

    expect(existsSync(sourcePath('app', 'quote', '[rfpId]', 'page.tsx'))).toBe(false);
    expect(page).toContain('<QuoteAccessClient />');
    expect(accessClient).toContain('window.location.hash.slice(1)');
    expect(accessClient).toContain("window.history.replaceState(null, '', '/quote')");
    expect(accessClient).toContain("fetch('/api/public/quote/access'");
  });

  it('documents the complete launch surface without legacy prototype claims', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('## Product status');
    expect(readme).toContain('## What a restaurant can do');
    expect(readme).toContain('## Repository map');
    expect(readme).toContain('src/app/');
    expect(readme).toContain('src/lib/');
    expect(readme).toContain('prisma/migrations/');
    expect(readme).not.toContain('Quarantined prototype modules:');
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
