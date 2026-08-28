import {
  EmailSignupError,
  createEmailWorkspace,
  type EmailSignupRepository,
} from '@/lib/auth/email-signup';

const input = {
  restaurantName: '  Tamarind Table  ',
  ownerName: '  Asha Rao  ',
  email: ' ASHA@EXAMPLE.COM ',
  password: 'secure password',
  addressLine: '12 Market Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560001',
  phone: '+91 98765 43210',
  timezone: 'Asia/Kolkata',
  gstin: '29abcde1234f1z5',
};

function repository(
  overrides: Partial<EmailSignupRepository> = {},
): EmailSignupRepository {
  return {
    createOwnerWorkspace: jest.fn().mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
    }),
    ...overrides,
  };
}

describe('email signup', () => {
  it('normalizes email and creates one atomic India workspace owner record', async () => {
    const repo = repository();

    await expect(createEmailWorkspace(input, repo)).resolves.toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(repo.createOwnerWorkspace).toHaveBeenCalledWith({
      restaurantName: 'Tamarind Table',
      ownerName: 'Asha Rao',
      email: 'asha@example.com',
      passwordHash: expect.stringMatching(/^\$argon2id\$/),
      addressLine: '12 Market Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin: '560001',
      phone: '+91 98765 43210',
      timezone: 'Asia/Kolkata',
      gstin: '29ABCDE1234F1Z5',
    });
  });

  it('returns one safe duplicate error for a lowercase email race', async () => {
    const repo = repository({
      createOwnerWorkspace: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
    });

    await expect(createEmailWorkspace(input, repo)).rejects.toMatchObject<
      Partial<EmailSignupError>
    >({
      code: 'EMAIL_ALREADY_REGISTERED',
      status: 409,
    });
  });

  it('requires every launch address field and validates email, password, and PIN', async () => {
    const cases = [
      { ...input, email: 'not-an-email' },
      { ...input, password: 'short' },
      { ...input, password: 'x'.repeat(1_025) },
      { ...input, addressLine: '' },
      { ...input, city: '' },
      { ...input, state: '' },
      { ...input, pin: '1234' },
      { ...input, phone: '' },
      { ...input, phone: '1'.repeat(33) },
      { ...input, gstin: 'not-a-gstin' },
    ];

    for (const invalid of cases) {
      await expect(createEmailWorkspace(invalid, repository())).rejects.toMatchObject({
        code: 'INVALID_SIGNUP',
        status: 400,
      });
    }
  });
});
