import {
  InvitationError,
  acceptInvitation,
  createInvitation,
  revokeInvitation,
  type InvitationRepository,
} from '@/lib/members/invitations';
import { digestOpaqueToken } from '@/lib/security/tokens';

const now = new Date('2026-08-28T10:00:00.000Z');
const owner = {
  userId: 'owner-a',
  tenantId: 'tenant-a',
};

function repository(
  overrides: Partial<InvitationRepository> = {},
): InvitationRepository {
  return {
    create: jest.fn().mockResolvedValue({ id: 'member-a' }),
    resolve: jest.fn().mockResolvedValue({ tenantId: 'tenant-a' }),
    consumeAcceptanceAttempt: jest.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 900,
    }),
    accept: jest.fn().mockResolvedValue({
      userId: 'member-a',
      tenantId: 'tenant-a',
    }),
    revoke: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('member invitations', () => {
  it('returns a raw link token once while storing only a 7-day digest', async () => {
    const repo = repository();

    const result = await createInvitation(
      {
        actor: owner,
        email: ' TEAM@EXAMPLE.COM ',
        role: 'MEMBER',
      },
      repo,
      now,
    );

    expect(result).toEqual({
      id: 'member-a',
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      email: 'team@example.com',
      role: 'MEMBER',
      expiresAt: new Date('2026-09-04T10:00:00.000Z'),
    });
    expect(repo.create).toHaveBeenCalledWith({
      actor: owner,
      email: 'team@example.com',
      role: 'MEMBER',
      tokenDigest: digestOpaqueToken('member-invitation', result.token),
      expiresAt: new Date('2026-09-04T10:00:00.000Z'),
      now,
    });
    expect(JSON.stringify(jest.mocked(repo.create).mock.calls)).not.toContain(
      result.token,
    );
  });

  it('validates invitation fields before the repository revalidates the owner', async () => {
    const repo = repository();

    for (const input of [
      { actor: owner, email: 'invalid' },
      { actor: owner, email: `${'a'.repeat(310)}@example.com` },
      { actor: owner, email: 'team@example.com', role: 'ADMIN' },
    ]) {
      await expect(createInvitation(input, repo, now)).rejects.toMatchObject({
        code: 'INVALID_INVITATION',
        status: 400,
      });
    }
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts only validated matching details through one atomic repository call', async () => {
    const repo = repository();
    const token = 'A'.repeat(43);

    await expect(
      acceptInvitation(
        {
          token,
          email: ' TEAM@EXAMPLE.COM ',
          name: '  Priya Shah  ',
          password: 'correct horse battery staple',
        },
        repo,
        now,
      ),
    ).resolves.toEqual({ userId: 'member-a', tenantId: 'tenant-a' });

    expect(repo.accept).toHaveBeenCalledWith({
      tokenDigest: digestOpaqueToken('member-invitation', token),
      tenantId: 'tenant-a',
      email: 'team@example.com',
      name: 'Priya Shah',
      passwordHash: expect.stringMatching(/^\$argon2id\$/),
    });
    expect(repo.resolve).toHaveBeenCalledWith({
      tokenDigest: digestOpaqueToken('member-invitation', token),
    });
  });

  it('rejects unknown tokens before doing account creation work', async () => {
    const repo = repository({
      resolve: jest.fn().mockResolvedValue(null),
      accept: jest.fn(),
    });

    await expect(
      acceptInvitation(
        {
          token: 'A'.repeat(43),
          email: 'team@example.com',
          name: 'Priya Shah',
          password: 'correct horse battery staple',
        },
        repo,
        now,
      ),
    ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE', status: 410 });
    expect(repo.accept).not.toHaveBeenCalled();
  });

  it('stops a rate-limited active link before attempting account creation', async () => {
    const token = 'A'.repeat(43);
    const accept = jest.fn();
    const consumeAcceptanceAttempt = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 321,
    });
    const repo = repository({ accept, consumeAcceptanceAttempt });

    await expect(
      acceptInvitation(
        {
          token,
          email: 'team@example.com',
          name: 'Priya Shah',
          password: 'correct horse battery staple',
        },
        repo,
        now,
      ),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 321,
    });
    expect(consumeAcceptanceAttempt).toHaveBeenCalledWith({
      tokenDigest: digestOpaqueToken('member-invitation', token),
      now,
    });
    expect(accept).not.toHaveBeenCalled();
  });

  it('uses one safe gone response for malformed, expired, revoked, replayed, or mismatched links', async () => {
    const unavailable = repository({ accept: jest.fn().mockResolvedValue(null) });

    for (const input of [
      { token: 'short', email: 'team@example.com', name: 'Priya', password: 'password-1' },
      { token: 'A'.repeat(43), email: 'other@example.com', name: 'Priya', password: 'password-1' },
    ]) {
      await expect(acceptInvitation(input, unavailable, now)).rejects.toMatchObject<
        Partial<InvitationError>
      >({
        code: 'INVITATION_UNAVAILABLE',
        status: 410,
        message: 'This invitation is invalid or no longer available.',
      });
    }
  });

  it('rejects invalid acceptance identity fields before storage', async () => {
    const repo = repository();
    const token = 'A'.repeat(43);

    for (const input of [
      { token, email: 'invalid', name: 'Priya', password: 'password-1' },
      { token, email: 'team@example.com', name: '', password: 'password-1' },
      {
        token,
        email: 'team@example.com',
        name: 'a'.repeat(201),
        password: 'password-1',
      },
      { token, email: 'team@example.com', name: 'Priya', password: 'short' },
      {
        token,
        email: 'team@example.com',
        name: 'Priya',
        password: 'a'.repeat(1_025),
      },
    ]) {
      await expect(acceptInvitation(input, repo, now)).rejects.toMatchObject({
        code: 'INVALID_INVITATION',
        status: 400,
      });
    }
    expect(repo.accept).not.toHaveBeenCalled();
  });

  it('passes only stable actor identifiers for locked owner revalidation', async () => {
    const repo = repository();

    await expect(
      revokeInvitation({ actor: owner, invitationId: 'invite-a' }, repo, now),
    ).resolves.toBeUndefined();
    expect(repo.revoke).toHaveBeenCalledWith({
      actor: owner,
      invitationId: 'invite-a',
      now,
    });

    expect(repo.revoke).toHaveBeenCalledWith({
      actor: { userId: 'owner-a', tenantId: 'tenant-a' },
      invitationId: 'invite-a',
      now,
    });
  });
});
