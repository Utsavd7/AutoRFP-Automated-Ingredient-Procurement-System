import { createPasswordRecord, verifyPassword } from '@/lib/password';

describe('password storage', () => {
  it('creates an Argon2id record using the launch cost floor', async () => {
    const record = await createPasswordRecord('correct horse battery staple');

    expect(record.passwordHash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
    expect(Object.keys(record)).toEqual(['passwordHash']);
    await expect(
      verifyPassword('correct horse battery staple', record.passwordHash),
    ).resolves.toBe(true);
  });

  it('rejects an incorrect Argon2id password', async () => {
    const record = await createPasswordRecord('correct horse battery staple');

    await expect(
      verifyPassword('wrong password', record.passwordHash),
    ).resolves.toBe(false);
  });

  it('rejects absent, malformed, and non-Argon2 records', async () => {
    await expect(
      verifyPassword('password', 'not-an-argon2-record'),
    ).resolves.toBe(false);
    await expect(verifyPassword('password', null)).resolves.toBe(false);
  });
});
