import { createHmac } from 'node:crypto';

import {
  MAX_PHOTO_TRANSFER_BATCH_BYTES,
  MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES,
  MAX_PHOTO_TRANSFER_IMAGE_BYTES,
  MAX_PHOTO_TRANSFER_IMAGES,
  MAX_PHOTO_TRANSFER_TOKEN_LENGTH,
  PHOTO_TRANSFER_CLOCK_SKEW_MS,
  PHOTO_TRANSFER_TTL_MS,
  parsePhotoTransferManifest,
  sanitizePhotoTransferFilename,
  type PhotoTransferFileMetadata,
  type PhotoTransferManifest,
} from '@/lib/menu/photo-transfer-contract';
import {
  derivePhotoTransferFileKey,
  derivePhotoTransferManifestKey,
  issuePhotoTransferToken,
  verifyPhotoTransferToken,
} from '@/lib/menu/photo-transfer';

const NOW = Date.UTC(2026, 8, 1, 10, 0, 0);
const SECRET = 'a-test-secret-that-is-long-enough-to-be-realistic';

function signPayload(payload: unknown) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function metadata(index: number, size = 1_024): PhotoTransferFileMetadata {
  return {
    index,
    name: `menu-${index + 1}.jpg`,
    type: 'image/jpeg',
    size,
    encryptedSize: size + MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES,
    iv: Buffer.alloc(12, index + 1).toString('base64url'),
  };
}

function manifest(overrides: Partial<PhotoTransferManifest> = {}): PhotoTransferManifest {
  return {
    sessionId: 'nHEjYxeJ_2yZYNQnXaVrpIoyprKsf68V',
    workspaceId: 'workspace-123',
    expiresAt: NOW + PHOTO_TRANSFER_TTL_MS,
    files: [metadata(0)],
    ...overrides,
  };
}

describe('photo transfer token', () => {
  it('issues and verifies a compact token with an exact 15-minute lifetime', () => {
    const issued = issuePhotoTransferToken({
      workspaceId: 'workspace-123',
      secret: SECRET,
      now: NOW,
    });

    expect(issued.expiresAt).toBe(NOW + 15 * 60 * 1_000);
    expect(issued.token.length).toBeLessThan(512);
    expect(verifyPhotoTransferToken({
      token: issued.token,
      secret: SECRET,
      now: NOW,
    })).toEqual({
      version: 1,
      sessionId: issued.sessionId,
      workspaceId: 'workspace-123',
      expiresAt: issued.expiresAt,
    });
  });

  it('rejects escaped workspace IDs and keeps the maximum safe ID token bounded', () => {
    const pathologicalWorkspaceId = '\u0000\\"'.repeat(42) + '\u0000\\';
    const maximumSafeWorkspaceId = 'A'.repeat(128);
    expect(pathologicalWorkspaceId).toHaveLength(128);

    expect(() => issuePhotoTransferToken({
      workspaceId: pathologicalWorkspaceId,
      secret: SECRET,
      now: NOW,
    })).toThrow('A valid workspace ID is required.');

    const issued = issuePhotoTransferToken({
      workspaceId: maximumSafeWorkspaceId,
      secret: SECRET,
      now: NOW,
    });
    expect(issued.token.length).toBeLessThanOrEqual(MAX_PHOTO_TRANSFER_TOKEN_LENGTH);
    expect(verifyPhotoTransferToken({
      token: issued.token,
      secret: SECRET,
      now: NOW,
    }).workspaceId).toBe(maximumSafeWorkspaceId);
  });

  it('returns the same generic error for tampered, expired, future, and malformed tokens', () => {
    const issued = issuePhotoTransferToken({
      workspaceId: 'workspace-123',
      secret: SECRET,
      now: NOW,
    });
    const [payload, signature] = issued.token.split('.');
    const tampered = `${payload}.${signature.endsWith('A') ? `${signature.slice(0, -1)}B` : `${signature.slice(0, -1)}A`}`;
    const expired = signPayload({
      version: 1,
      sessionId: issued.sessionId,
      workspaceId: 'workspace-123',
      expiresAt: NOW - 1,
    });
    const future = signPayload({
      version: 1,
      sessionId: issued.sessionId,
      workspaceId: 'workspace-123',
      expiresAt: NOW + PHOTO_TRANSFER_TTL_MS + PHOTO_TRANSFER_CLOCK_SKEW_MS + 1,
    });
    const extraField = signPayload({
      version: 1,
      sessionId: issued.sessionId,
      workspaceId: 'workspace-123',
      expiresAt: NOW + PHOTO_TRANSFER_TTL_MS,
      admin: true,
    });

    for (const token of [
      tampered,
      expired,
      future,
      extraField,
      'not-a-token',
      `${payload}=.${signature}`,
      'x'.repeat(1_025),
    ]) {
      expect(() => verifyPhotoTransferToken({ token, secret: SECRET, now: NOW }))
        .toThrow('Invalid or expired photo transfer.');
    }
  });
});

describe('photo transfer contract', () => {
  it('accepts a valid ten-image, 40 MiB manifest parsed from untrusted JSON', () => {
    const files = Array.from({ length: MAX_PHOTO_TRANSFER_IMAGES }, (_, index) => (
      metadata(index, MAX_PHOTO_TRANSFER_BATCH_BYTES / MAX_PHOTO_TRANSFER_IMAGES)
    ));
    const stored = JSON.stringify(manifest({ files, completedAt: NOW + 1_000 }));

    expect(parsePhotoTransferManifest(stored)).toEqual(manifest({
      files,
      completedAt: NOW + 1_000,
    }));
  });

  it('rejects invalid MIME types, image sizes, encrypted overhead, totals, indexes, and secret fields', () => {
    const invalidManifests: unknown[] = [
      { ...manifest(), files: [metadata(0), { ...metadata(1), type: 'image/gif' }] },
      manifest({ files: [metadata(0, MAX_PHOTO_TRANSFER_IMAGE_BYTES + 1)] }),
      manifest({ files: [{ ...metadata(0), encryptedSize: 1_024 + MAX_PHOTO_TRANSFER_ENCRYPTED_OVERHEAD_BYTES + 1 }] }),
      manifest({ files: Array.from({ length: 6 }, (_, index) => metadata(index, 7 * 1_024 * 1_024)) }),
      manifest({ files: [metadata(1)] }),
      { ...manifest(), encryptionKey: 'must-never-be-stored' },
    ];

    for (const value of invalidManifests) {
      expect(() => parsePhotoTransferManifest(value)).toThrow('Invalid photo transfer manifest.');
    }
  });

  it('bounds and sanitizes filenames for display', () => {
    const sanitized = sanitizePhotoTransferFilename('../private\\menu\u0000 photo.jpg'.repeat(20));

    expect(sanitized).not.toMatch(/[\\/\u0000-\u001f\u007f]/);
    expect(sanitized.length).toBeLessThanOrEqual(120);
    expect(sanitizePhotoTransferFilename('   ')).toBe('photo');
  });
});

describe('photo transfer storage keys', () => {
  it('uses only a stable SHA-256-derived opaque session prefix', () => {
    const sessionId = 'nHEjYxeJ_2yZYNQnXaVrpIoyprKsf68V';
    const token = issuePhotoTransferToken({
      workspaceId: 'workspace-123',
      secret: SECRET,
      now: NOW,
    }).token;
    const manifestKey = derivePhotoTransferManifestKey(sessionId);
    const fileKey = derivePhotoTransferFileKey(sessionId, 3);

    expect(manifestKey).toMatch(/^sessions\/[a-f0-9]{64}\/manifest\.json$/);
    expect(fileKey).toMatch(/^sessions\/[a-f0-9]{64}\/files\/3\.bin$/);
    expect(manifestKey).not.toContain(sessionId);
    expect(fileKey).not.toContain(sessionId);
    expect(manifestKey).not.toContain(token);
    expect(derivePhotoTransferManifestKey(sessionId)).toBe(manifestKey);
  });
});
