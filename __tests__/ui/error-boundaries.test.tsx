import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

describe('production error boundaries', () => {
  it('uses factual QuotePlate recovery copy without exposing errors in production', () => {
    for (const relativePath of [
      'src/app/error.tsx',
      'src/app/(app)/error.tsx',
    ]) {
      const source = readFileSync(path.join(root, relativePath), 'utf8');
      expect(source).not.toMatch(/demo|local data|violet|bg-black/i);
      expect(source).toContain("process.env.NODE_ENV !== 'production'");
      expect(source).toMatch(/saved|record/i);
      expect(source).toMatch(/Try again|Retry/);
    }
  });
});
