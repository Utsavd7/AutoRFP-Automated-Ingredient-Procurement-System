import { renderToStaticMarkup } from 'react-dom/server';

import JoinInvitationPage, {
  metadata,
} from '@/app/(public)/join/[token]/page';

describe('public invitation acceptance page', () => {
  it('renders an accessible focused join form', async () => {
    const token = 'A'.repeat(43);
    const page = await JoinInvitationPage({
      params: Promise.resolve({ token }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Join your restaurant workspace');
    expect(html).toContain('name="name"');
    expect(html).toContain('autoComplete="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('minLength="8"');
    expect(html).toContain('Accept invitation');
  });

  it('prevents invitation URLs from being indexed or used as referrers', () => {
    expect(metadata).toEqual(
      expect.objectContaining({
        robots: { index: false, follow: false },
        referrer: 'no-referrer',
      }),
    );
  });
});
