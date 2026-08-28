import {
  createOpaqueToken,
  digestOpaqueToken,
} from '@/lib/security/tokens';

describe('opaque security tokens', () => {
  it('creates a 256-bit base64url token and stores only its SHA-256 digest', () => {
    const token = createOpaqueToken('member-invitation');

    expect(token.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token.raw, 'base64url')).toHaveLength(32);
    expect(token.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(token.digest).toBe(
      digestOpaqueToken('member-invitation', token.raw),
    );
    expect(token.digest).not.toContain(token.raw);
  });

  it('domain-separates invitation and supplier-request digests', () => {
    const raw = 'A'.repeat(43);

    expect(digestOpaqueToken('member-invitation', raw)).not.toBe(
      digestOpaqueToken('supplier-request', raw),
    );
  });

  it('rejects malformed raw tokens before a lookup', () => {
    for (const raw of ['', 'short', `${'A'.repeat(42)}!`, 'A'.repeat(44)]) {
      expect(() => digestOpaqueToken('member-invitation', raw)).toThrow(
        'Invalid token',
      );
    }
  });
});
