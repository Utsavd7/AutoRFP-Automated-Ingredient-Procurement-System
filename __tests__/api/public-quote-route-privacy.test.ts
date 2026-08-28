import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

test('supplier access scrubs the fragment and posts to a tokenless route', () => {
  const root = path.resolve(__dirname, '../..');
  const client = readFileSync(
    path.join(root, 'src/app/quote/QuoteAccessClient.tsx'),
    'utf8',
  );

  expect(client).toContain("params.get('token')");
  expect(client).toContain("window.history.replaceState(null, '', '/quote')");
  expect(client).toContain("fetch('/api/public/quote/access'");
  expect(client).not.toContain('/api/public/quote/${');
  expect(
    existsSync(path.join(root, 'src/app/api/public/quote/[token]/route.ts')),
  ).toBe(false);
});

test('supplier quote page is frame-protected and mobile form controls stay accessible', () => {
  const root = path.resolve(__dirname, '../..');
  const config = readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  const css = readFileSync(
    path.join(root, 'src/app/quote/quote-access.module.css'),
    'utf8',
  );

  expect(config).toContain("source: '/quote/:path*'");
  expect(config).toContain("source: '/:path*'");
  expect(config).toContain("key: 'Content-Security-Policy'");
  expect(config).toContain("frame-ancestors 'none'");
  expect(config).toContain("base-uri 'none'");
  expect(config).toContain("object-src 'none'");
  expect(config).toContain("key: 'X-Frame-Options', value: 'DENY'");
  expect(config).toContain("key: 'X-Content-Type-Options', value: 'nosniff'");
  expect(config).toContain("key: 'Referrer-Policy', value: 'no-referrer'");
  expect(config).toContain("process.env.NODE_ENV === 'production'");
  expect(config).toContain("'unsafe-eval'");
  expect(css).not.toContain('!important');
  expect(css).toMatch(/font:\s*600 1rem\/1\.2/);
  expect(css).toMatch(
    /\.noQuote,\s*\.lineFields \.checkField\s*\{[^}]*min-height:\s*44px/,
  );
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.indicator[\s\S]*animation:\s*none/,
  );
});
