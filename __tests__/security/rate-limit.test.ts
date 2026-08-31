import { digestRateLimitKey } from '@/lib/security/rate-limit';

describe('database rate-limit keys', () => {
  it('domain-separates and re-digests an already opaque subject digest', () => {
    const subjectDigest = 'a'.repeat(64);
    const invitationKey = digestRateLimitKey(
      'member-invitation-accept',
      subjectDigest,
    );
    const supplierKey = digestRateLimitKey('supplier-request', subjectDigest);
    const applicationKey = digestRateLimitKey(
      'supplier-application',
      subjectDigest,
    );

    expect(invitationKey).toMatch(/^[a-f0-9]{64}$/);
    expect(invitationKey).not.toBe(subjectDigest);
    expect(invitationKey).not.toBe(supplierKey);
    expect(applicationKey).not.toBe(supplierKey);
  });

  it('rejects malformed subject digests before database access', () => {
    for (const digest of ['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
      expect(() =>
        digestRateLimitKey('member-invitation-accept', digest),
      ).toThrow('Invalid rate-limit subject digest');
    }
  });
});
