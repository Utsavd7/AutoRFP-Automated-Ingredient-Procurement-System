import { hash, verify, type Algorithm } from '@node-rs/argon2';

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
  };
}

export async function verifyPassword(
  password: string,
  passwordHash?: string | null,
) {
  if (!passwordHash?.startsWith('$argon2id$')) return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
