import { createHash, timingSafeEqual } from 'crypto';

import { hash, verify, type Algorithm } from '@node-rs/argon2';

function sha256Hex(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const ARGON2_OPTIONS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function createPasswordRecord(password: string) {
  return {
    passwordHash: await hash(password, ARGON2_OPTIONS),
    legacyPasswordSalt: null,
  };
}

export async function verifyPassword(
  password: string,
  passwordHash?: string | null,
  legacyPasswordSalt?: string | null,
) {
  if (!passwordHash) return { valid: false, needsUpgrade: false };

  if (passwordHash.startsWith('$argon2id$')) {
    try {
      return {
        valid: await verify(passwordHash, password),
        needsUpgrade: false,
      };
    } catch {
      return { valid: false, needsUpgrade: false };
    }
  }

  if (
    !legacyPasswordSalt ||
    !/^[a-f\d]+$/i.test(legacyPasswordSalt) ||
    legacyPasswordSalt.length % 2 !== 0 ||
    !/^[a-f\d]{64}$/i.test(passwordHash)
  ) {
    return { valid: false, needsUpgrade: false };
  }

  const salt = Buffer.from(legacyPasswordSalt, 'hex');
  const candidate = Buffer.from(
    sha256Hex(Buffer.concat([salt, Buffer.from(password)])),
    'hex',
  );
  const expected = Buffer.from(passwordHash, 'hex');
  const valid = timingSafeEqual(candidate, expected);
  return { valid, needsUpgrade: valid };
}
