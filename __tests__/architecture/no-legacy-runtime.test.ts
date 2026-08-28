import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, 'src');

const bannedPackageNames = [
  'chromadb',
  'groq-sdk',
  'inngest',
  'openai',
  'resend',
] as const;

const isBannedPackage = (specifier: string) => {
  const packageName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];

  return (
    packageName.startsWith('@langchain/') ||
    packageName.startsWith('@sentry/') ||
    packageName.startsWith('@openai/') ||
    packageName.startsWith('@groq/') ||
    packageName.endsWith('/openai') ||
    packageName.endsWith('/groq') ||
    bannedPackageNames.includes(
      packageName as (typeof bannedPackageNames)[number],
    )
  );
};

const productionSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return productionSourceFiles(path);
    if (!['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'].includes(extname(entry.name))) {
      return [];
    }

    return [path];
  });

const importedPackages = (source: string) => {
  const specifiers = new Set<string>();
  const importPattern =
    /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s+)["']([^"']+)["']/g;

  for (const match of source.matchAll(importPattern)) specifiers.add(match[1]);

  return [...specifiers];
};

describe('legacy runtime isolation', () => {
  it('has no production imports from hosted or legacy orchestration services', () => {
    const importViolations = [
      ...productionSourceFiles(sourceRoot),
      join(projectRoot, 'next.config.ts'),
    ].flatMap((path) =>
      importedPackages(readFileSync(path, 'utf8'))
        .filter(isBannedPackage)
        .map((specifier) => `${relative(projectRoot, path)}: ${specifier}`),
    );

    expect(importViolations).toEqual([]);
  });

  it('has no installed runtime dependency on hosted or legacy orchestration services', () => {
    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as Record<string, Record<string, string> | undefined>;
    const dependencyGroups = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ];
    const dependencyViolations = dependencyGroups.flatMap((group) =>
      Object.keys(packageJson[group] ?? {})
        .filter(isBannedPackage)
        .map((packageName) => `${group}: ${packageName}`),
    );

    expect(dependencyViolations).toEqual([]);
  });

  it('does not retain obsolete route or shell authority', () => {
    expect(
      existsSync(join(sourceRoot, 'app', 'quote', '[rfpId]', 'page.tsx')),
    ).toBe(false);
    expect(
      existsSync(join(sourceRoot, 'components', 'CommandPalette.tsx')),
    ).toBe(false);
    expect(
      existsSync(join(sourceRoot, 'components', 'ToastViewport.tsx')),
    ).toBe(false);
  });

  it('has no Sentry bootstrap files or Sentry-specific Next.js configuration', () => {
    const nextConfig = readFileSync(join(projectRoot, 'next.config.ts'), 'utf8');
    const instrumentationPath = join(projectRoot, 'instrumentation.ts');
    const instrumentation = existsSync(instrumentationPath)
      ? readFileSync(instrumentationPath, 'utf8')
      : '';

    expect(existsSync(join(projectRoot, 'sentry.client.config.ts'))).toBe(false);
    expect(existsSync(join(projectRoot, 'sentry.server.config.ts'))).toBe(false);
    expect(
      existsSync(join(sourceRoot, 'lib', 'security', 'invitation-telemetry.ts')),
    ).toBe(false);
    expect(nextConfig).not.toMatch(/sentry/i);
    expect(instrumentation).not.toMatch(/sentry/i);
  });

  it('keeps a local accessible recovery boundary without production reporting', () => {
    const errorBoundary = readFileSync(
      join(sourceRoot, 'components', 'ErrorBoundary.tsx'),
      'utf8',
    );

    expect(errorBoundary).toContain('role="alert"');
    expect(errorBoundary).toContain('aria-live="assertive"');
    expect(errorBoundary).toContain("process.env.NODE_ENV !== 'production'");
    expect(errorBoundary).toContain('console.error');
    expect(errorBoundary).not.toContain('{this.state.error?.message');
    expect(errorBoundary).toContain('Please try again. Your saved work is still safe.');
  });
});
