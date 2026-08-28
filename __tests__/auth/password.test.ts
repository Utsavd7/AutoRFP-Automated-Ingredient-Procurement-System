import { createHash, randomBytes } from 'crypto';

import { createPasswordRecord, verifyPassword } from '@/lib/password';

function legacyRecord(password: string) {
  const salt = randomBytes(16);
  return {
    salt: salt.toString('hex'),
    hash: createHash('sha256')
      .update(Buffer.concat([salt, Buffer.from(password)]))
      .digest('hex'),
  };
}

describe('password storage', () => {
  it('creates an Argon2id record using the launch cost floor', async () => {
    const record = await createPasswordRecord('correct horse battery staple');

    expect(record.passwordHash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
    expect(record.legacyPasswordSalt).toBeNull();
    await expect(
      verifyPassword('correct horse battery staple', record.passwordHash, null),
    ).resolves.toEqual({ valid: true, needsUpgrade: false });
  });

  it('rejects an incorrect Argon2id password', async () => {
    const record = await createPasswordRecord('correct horse battery staple');

    await expect(
      verifyPassword('wrong password', record.passwordHash, null),
    ).resolves.toEqual({ valid: false, needsUpgrade: false });
  });

  it('recognizes a valid legacy SHA-256 record and requests an upgrade', async () => {
    const legacy = legacyRecord('legacy password');

    await expect(
      verifyPassword('legacy password', legacy.hash, legacy.salt),
    ).resolves.toEqual({ valid: true, needsUpgrade: true });
  });

  it('rejects malformed and incorrect legacy records', async () => {
    const legacy = legacyRecord('legacy password');

    await expect(
      verifyPassword('wrong password', legacy.hash, legacy.salt),
    ).resolves.toEqual({ valid: false, needsUpgrade: false });
    await expect(
      verifyPassword('legacy password', legacy.hash, 'not-hex'),
    ).resolves.toEqual({ valid: false, needsUpgrade: false });
    await expect(verifyPassword('password', null, null)).resolves.toEqual({
      valid: false,
      needsUpgrade: false,
    });
  });
});
