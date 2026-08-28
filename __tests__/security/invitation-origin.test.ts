import { resolveInvitationOrigin } from '@/lib/security/invitation-origin';

describe('invitation origin', () => {
  it('requires an explicit HTTPS canonical origin in production', () => {
    expect(() => resolveInvitationOrigin({ NODE_ENV: 'production' })).toThrow(
      'NEXTAUTH_URL must be configured',
    );
    expect(() =>
      resolveInvitationOrigin({
        NODE_ENV: 'production',
        VERCEL_URL: 'preview.example.vercel.app',
      }),
    ).toThrow('NEXTAUTH_URL must be configured');
    expect(() =>
      resolveInvitationOrigin({
        NODE_ENV: 'production',
        NEXTAUTH_URL: 'http://quoteplate.example',
      }),
    ).toThrow('HTTPS');

    expect(
      resolveInvitationOrigin({
        NODE_ENV: 'production',
        NEXTAUTH_URL: 'https://app.quoteplate.example/path?query=1',
      }).toString(),
    ).toBe('https://app.quoteplate.example/');
  });

  it('allows an HTTP loopback origin for a local production-like server', () => {
    expect(
      resolveInvitationOrigin({
        NODE_ENV: 'production',
        NEXTAUTH_URL: 'http://127.0.0.1:52560',
      }).toString(),
    ).toBe('http://127.0.0.1:52560/');
  });

  it('allows an HTTP loopback fallback only outside production', () => {
    expect(resolveInvitationOrigin({ NODE_ENV: 'test' }).toString()).toBe(
      'http://localhost:3000/',
    );
    expect(() =>
      resolveInvitationOrigin({
        NODE_ENV: 'development',
        NEXTAUTH_URL: 'http://restaurant.example',
      }),
    ).toThrow('HTTPS');
  });

  it('rejects credentials embedded in the configured origin', () => {
    expect(() =>
      resolveInvitationOrigin({
        NODE_ENV: 'production',
        NEXTAUTH_URL: 'https://operator:secret@app.quoteplate.example',
      }),
    ).toThrow('credentials');
  });
});
