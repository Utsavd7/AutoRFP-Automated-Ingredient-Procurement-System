import { createHash, randomBytes } from 'crypto';

import {
  CredentialsAuthError,
  authenticateCredentials,
  type CredentialsRepository,
} from '@/lib/auth/credentials';

function legacyRecord(password: string) {
  const salt = randomBytes(16);
  return {
    salt: salt.toString('hex'),
    hash: createHash('sha256')
      .update(Buffer.concat([salt, Buffer.from(password)]))
      .digest('hex'),
  };
}

const legacy = legacyRecord('valid password');
const user = {
  id: 'user-1',
  tenantId: 'tenant-1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  passwordHash: legacy.hash,
  legacyPasswordSalt: legacy.salt,
  isActive: true,
  tenant: { isActive: true },
};

function repository(
  overrides: Partial<CredentialsRepository> = {},
): CredentialsRepository {
  return {
    findByEmail: jest.fn().mockResolvedValue(user),
    recordSuccessfulLogin: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function allowRateLimit() {
  return jest.fn().mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 900,
  });
}

function authenticate(
  credentials: { email?: string | null; password?: string | null },
  repo: CredentialsRepository,
  dependencies: Parameters<typeof authenticateCredentials>[2] = {},
) {
  return authenticateCredentials(credentials, repo, {
    clientIdentifier: null,
    now: new Date('2026-08-28T00:00:00.000Z'),
    rateLimit: allowRateLimit(),
    ...dependencies,
  });
}

describe('credentials authentication', () => {
  it('rejects a throttled attempt with the same generic credential failure', async () => {
    const repo = repository();
    const rateLimit = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 300,
    });
    await expect(
      authenticate(
        { email: ' ASHA@EXAMPLE.COM ', password: 'valid password' },
        repo,
        {
          clientIdentifier: '203.0.113.9',
          now: new Date('2026-08-28T00:00:00.000Z'),
          rateLimit,
        },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });
    expect(rateLimit).toHaveBeenCalledWith({
      clientIdentifier: '203.0.113.9',
      email: 'asha@example.com',
      now: new Date('2026-08-28T00:00:00.000Z'),
    });
    expect(repo.findByEmail).not.toHaveBeenCalled();
  });

  it('performs Argon2-shaped verification for absent and unusable accounts', async () => {
    const verify = jest.fn().mockResolvedValue({
      valid: false,
      needsUpgrade: false,
    });
    const allow = jest.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 300,
    });
    const cases = [
      repository({ findByEmail: jest.fn().mockResolvedValue(null) }),
      repository({
        findByEmail: jest.fn().mockResolvedValue({ ...user, isActive: false }),
      }),
      repository({
        findByEmail: jest.fn().mockResolvedValue({
          ...user,
          passwordHash: null,
          legacyPasswordSalt: null,
        }),
      }),
    ];

    for (const repo of cases) {
      verify.mockClear();
      await expect(
        authenticate(
          { email: user.email, password: 'wrong password' },
          repo,
          {
            clientIdentifier: null,
            now: new Date('2026-08-28T00:00:00.000Z'),
            rateLimit: allow,
            verifyPassword: verify,
          },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(verify).toHaveBeenCalledWith(
        'wrong password',
        expect.stringMatching(/^\$argon2id\$/),
        null,
      );
    }
  });

  it('lowercases email and immediately replaces a verified legacy hash', async () => {
    const repo = repository();

    await expect(
      authenticate(
        { email: ' ASHA@EXAMPLE.COM ', password: 'valid password' },
        repo,
      ),
    ).resolves.toEqual({
      id: 'user-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      name: 'Asha Rao',
      email: 'asha@example.com',
    });
    expect(repo.findByEmail).toHaveBeenCalledWith('asha@example.com');
    expect(repo.recordSuccessfulLogin).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({
        passwordHash: expect.stringMatching(/^\$argon2id\$/),
        legacyPasswordSalt: null,
      }),
    );
  });

  it('records login without replacing a current Argon2id hash', async () => {
    const firstRepo = repository();
    await authenticate(
      { email: user.email, password: 'valid password' },
      firstRepo,
    );
    const upgrade = jest.mocked(firstRepo.recordSuccessfulLogin).mock.calls[0][2];
    const repo = repository({
      findByEmail: jest.fn().mockResolvedValue({
        ...user,
        passwordHash: upgrade.passwordHash,
        legacyPasswordSalt: null,
      }),
    });

    await authenticate(
      { email: user.email, password: 'valid password' },
      repo,
    );

    expect(repo.recordSuccessfulLogin).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      {},
    );
  });

  it('uses one generic failure for wrong, inactive, or OAuth-only accounts', async () => {
    const cases = [
      repository({ findByEmail: jest.fn().mockResolvedValue(null) }),
      repository({
        findByEmail: jest
          .fn()
          .mockResolvedValue({ ...user, isActive: false }),
      }),
      repository({
        findByEmail: jest.fn().mockResolvedValue({
          ...user,
          tenant: { isActive: false },
        }),
      }),
      repository({
        findByEmail: jest.fn().mockResolvedValue({
          ...user,
          passwordHash: null,
          legacyPasswordSalt: null,
        }),
      }),
    ];

    for (const repo of cases) {
      await expect(
        authenticate(
          { email: user.email, password: 'wrong password' },
          repo,
        ),
      ).rejects.toMatchObject<Partial<CredentialsAuthError>>({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
      expect(repo.recordSuccessfulLogin).not.toHaveBeenCalled();
    }
  });

  it('rejects oversized credentials before a database or Argon2 lookup', async () => {
    const repo = repository();

    await expect(
      authenticate(
        { email: user.email, password: 'x'.repeat(1_025) },
        repo,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(repo.findByEmail).not.toHaveBeenCalled();
  });

  it('replaces database details with a safe temporary-unavailability error', async () => {
    const repo = repository({
      findByEmail: jest
        .fn()
        .mockRejectedValue(new Error('postgres://admin:secret@internal/db')),
    });

    await expect(
      authenticate(
        { email: user.email, password: 'valid password' },
        repo,
      ),
    ).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      message: 'Sign in is temporarily unavailable. Try again shortly.',
    });
  });
});
