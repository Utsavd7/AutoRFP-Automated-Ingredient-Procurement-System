import {
  consumePhotoTransferRateLimit,
  digestPhotoTransferRateLimitSubject,
} from '@/lib/menu/photo-transfer-rate-limit';

const now = new Date('2027-01-15T08:00:00.000Z');

describe('photo transfer rate limits', () => {
  it('uses an opaque workspace/user subject for ten creates per fifteen minutes', async () => {
    const consume = jest.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 900,
    });

    await expect(consumePhotoTransferRateLimit({
      operation: 'create',
      workspaceId: 'tenant-a',
      userId: 'user-a',
      now,
    }, consume)).resolves.toEqual({ allowed: true, retryAfterSeconds: 900 });

    const subjectDigest = digestPhotoTransferRateLimitSubject(
      'create',
      'tenant-a\u0000user-a',
    );
    expect(subjectDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(subjectDigest).not.toContain('tenant-a');
    expect(consume).toHaveBeenCalledWith({
      scope: 'menu-photo-transfer-create',
      subjectDigest,
      limit: 10,
      windowMs: 15 * 60 * 1_000,
      now,
    });
  });

  it('uses an opaque signed-session subject for thirty upload attempts per window', async () => {
    const consume = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 240,
    });
    const sessionId = 'A'.repeat(32);

    await expect(consumePhotoTransferRateLimit({
      operation: 'upload',
      sessionId,
      now,
    }, consume)).resolves.toEqual({ allowed: false, retryAfterSeconds: 240 });

    expect(consume).toHaveBeenCalledWith({
      scope: 'menu-photo-transfer-upload',
      subjectDigest: digestPhotoTransferRateLimitSubject('upload', sessionId),
      limit: 30,
      windowMs: 15 * 60 * 1_000,
      now,
    });
  });
});
