import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('mobile navigation accessibility contract', () => {
  it('closes on navigation and provides labelled open, close, and Escape actions', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );

    expect(source).toContain('onClick={onNav}');
    expect(source).toContain("if (event.key === 'Escape') {");
    expect(source).toContain('aria-label="Open navigation"');
    expect(source).toContain('aria-label="Close navigation"');
    expect(source).toContain("if (event.key !== 'Tab') return");
    expect(source).toContain('inert={mobileOpen ? true : undefined}');
    expect(source).toContain('opener?.focus()');
  });
});
