import {
  GoogleIdentityError,
  resolveGoogleIdentity,
  type GoogleIdentityRepository,
} from '@/lib/auth/google-identity';

const onboarding = {
  restaurantName: 'Tamarind Table',
  ownerName: 'Asha Rao',
  email: 'asha@example.com',
  addressLine: '12 Market Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560001',
  phone: '+919876543210',
  timezone: 'Asia/Kolkata',
  gstin: null,
  expiresAt: '2026-08-28T00:10:00.000Z',
};

const activeOwner = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  role: 'OWNER' as const,
  userIsActive: true,
  tenantIsActive: true,
};

function repository(
  overrides: Partial<GoogleIdentityRepository> = {},
): GoogleIdentityRepository {
  return {
    findIdentity: jest.fn().mockResolvedValue(null),
    findUserByEmail: jest.fn().mockResolvedValue(null),
    createOwnerIdentity: jest.fn().mockResolvedValue(activeOwner),
    touchLogin: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const account = { provider: 'google', providerAccountId: 'google-sub-123' };
const profile = {
  sub: 'google-sub-123',
  email: 'Asha@Example.com',
  email_verified: true,
  name: 'Asha Rao',
};

describe('Google OAuth identity resolution', () => {
  it('creates the workspace owner for a verified Google signup', async () => {
    const repo = repository();

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding }, repo),
    ).resolves.toEqual(activeOwner);
    expect(repo.createOwnerIdentity).toHaveBeenCalledWith({
      ...onboarding,
      email: 'asha@example.com',
      provider: 'google',
      providerAccountId: 'google-sub-123',
    });
  });

  it('matches a returning user only by stable provider account ID', async () => {
    const repo = repository({
      findIdentity: jest.fn().mockResolvedValue(activeOwner),
    });

    await expect(
      resolveGoogleIdentity(
        {
          account,
          profile: { ...profile, email: 'new-address@example.com' },
          onboarding: null,
        },
        repo,
      ),
    ).resolves.toEqual(activeOwner);
    expect(repo.findUserByEmail).not.toHaveBeenCalled();
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('rejects unverified Google email before any database access', async () => {
    const repo = repository();

    await expect(
      resolveGoogleIdentity(
        { account, profile: { ...profile, email_verified: false }, onboarding },
        repo,
      ),
    ).rejects.toMatchObject<Partial<GoogleIdentityError>>({
      code: 'GOOGLE_EMAIL_UNVERIFIED',
    });
    expect(repo.findIdentity).not.toHaveBeenCalled();
  });

  it('never silently links an existing password user by email', async () => {
    const repo = repository({
      findUserByEmail: jest.fn().mockResolvedValue(activeOwner),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding }, repo),
    ).rejects.toMatchObject<Partial<GoogleIdentityError>>({
      code: 'EMAIL_ALREADY_REGISTERED',
    });
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('rejects a signup when the verified Google email differs from onboarding', async () => {
    const repo = repository();

    await expect(
      resolveGoogleIdentity(
        {
          account,
          profile: { ...profile, email: 'different@example.com' },
          onboarding,
        },
        repo,
      ),
    ).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_MISMATCH' });
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('rejects inactive users and tenants even with a valid provider identity', async () => {
    const inactiveUser = repository({
      findIdentity: jest
        .fn()
        .mockResolvedValue({ ...activeOwner, userIsActive: false }),
    });
    const inactiveTenant = repository({
      findIdentity: jest
        .fn()
        .mockResolvedValue({ ...activeOwner, tenantIsActive: false }),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding: null }, inactiveUser),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    await expect(
      resolveGoogleIdentity(
        { account, profile, onboarding: null },
        inactiveTenant,
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });

  it('converges a same-provider callback race without linking by email', async () => {
    const findIdentity = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeOwner);
    const repo = repository({
      findIdentity,
      createOwnerIdentity: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding }, repo),
    ).resolves.toEqual(activeOwner);
    expect(findIdentity).toHaveBeenCalledTimes(2);
  });

  it('refuses a different-provider-ID email collision after a create race', async () => {
    const repo = repository({
      findIdentity: jest.fn().mockResolvedValue(null),
      findUserByEmail: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(activeOwner),
      createOwnerIdentity: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding }, repo),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });
});
