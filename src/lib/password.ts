import { createHash, randomBytes } from 'crypto';

function sha256Hex(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function createPasswordRecord(password: string) {
  const salt = randomBytes(16);
  return {
    passwordSalt: salt.toString('hex'),
    passwordHash: sha256Hex(Buffer.concat([salt, Buffer.from(password)])),
  };
}

export function verifyPassword(password: string, hash?: string | null, saltHex?: string | null) {
  if (!hash || !saltHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  return sha256Hex(Buffer.concat([salt, Buffer.from(password)])) === hash;
}
