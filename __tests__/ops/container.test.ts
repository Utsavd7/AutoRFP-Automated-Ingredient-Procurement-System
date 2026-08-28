import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('production container', () => {
  it('uses the standalone Next output and an unprivileged runtime', () => {
    const nextConfig = read('next.config.ts');
    const dockerfile = read('Dockerfile');

    expect(nextConfig).toContain("output: 'standalone'");
    expect(dockerfile).toContain('FROM node:20-bookworm-slim AS dependencies');
    expect(dockerfile).toContain('RUN npm ci --omit=peer');
    expect(dockerfile).toContain('/app/.next/standalone');
    expect(dockerfile).toContain('USER nextjs');
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
    expect(dockerfile).toContain('QUOTEPLATE_RUNTIME_STARTUP_CHECK=1');
    expect(dockerfile).toContain('/api/health/live');
    expect(dockerfile).not.toMatch(/ARG\s+(?:DATABASE|DIRECT|NEXTAUTH|GOOGLE|SECRET|TOKEN)/i);
  });

  it('keeps local secrets, tests, and build output outside the image context', () => {
    const ignored = read('.dockerignore');
    for (const entry of ['.env', 'node_modules', '.next', '__tests__', 'tests', 'test-results']) {
      expect(ignored).toContain(entry);
    }
  });

  it('documents separate pooled runtime and privileged migration connections', () => {
    const sample = read('.env.sample');
    expect(sample).toContain('ep-YOUR_PROJECT-pooler');
    expect(sample).toContain('connection_limit=5');
    expect(sample).not.toMatch(/^(?:DIRECT_URL|NEON_DIRECT_DATABASE_URL)=/m);
    expect(sample).toContain('QUOTEPLATE_RUNTIME_STARTUP_CHECK');
    expect(sample).not.toContain('supabase');
  });

  it('checks a secret-free build and directly runs the built runtime validator', () => {
    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).toContain("require('./.next/server/instrumentation.js').register()");
    expect(workflow).toContain('QUOTEPLATE_RUNTIME_STARTUP_CHECK: "1"');
    expect(workflow).toContain('Invalid production environment');
    expect(workflow).not.toContain('timeout 15s node .next/standalone/server.js');
  });
});
