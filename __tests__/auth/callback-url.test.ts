import {
  createSignInRedirect,
  resolveAuthCallback,
} from '@/lib/auth/callback-url';

describe('authentication callback destinations', () => {
  it('preserves intended protected paths with their query and hash', () => {
    expect(resolveAuthCallback('/procurement/request-12?view=quotes#award')).toBe(
      '/procurement/request-12?view=quotes#award',
    );
    expect(resolveAuthCallback('/settings')).toBe('/settings');
    expect(resolveAuthCallback('/suppliers/new')).toBe('/suppliers/new');
  });

  it('falls back to the dashboard for external, malformed, or public paths', () => {
    for (const unsafe of [
      undefined,
      null,
      '',
      'https://attacker.example/collect',
      '//attacker.example/collect',
      '/\\attacker.example/collect',
      '/signin',
      '/product',
      ['/procurement', '/settings'],
    ]) {
      expect(resolveAuthCallback(unsafe)).toBe('/dashboard');
    }
  });

  it('builds a sign-in destination that safely retains the full protected path', () => {
    expect(
      createSignInRedirect('/settings?section=members#pending-invitations'),
    ).toBe(
      '/signin?callbackUrl=%2Fsettings%3Fsection%3Dmembers%23pending-invitations',
    );
    expect(createSignInRedirect('//attacker.example/collect')).toBe(
      '/signin?callbackUrl=%2Fdashboard',
    );
  });
});
