const KEY_BYTES = 32;
const IV_BYTES = 12;

function webCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable.');
  }
  return globalThis.crypto;
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string, expectedBytes: number, errorMessage: string) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (decoded.byteLength !== expectedBytes || encodeBase64Url(decoded) !== value) {
      throw new Error();
    }
    return decoded;
  } catch {
    throw new Error(errorMessage);
  }
}

export async function generatePhotoTransferKey() {
  return webCrypto().subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportPhotoTransferKey(key: CryptoKey) {
  const raw = await webCrypto().subtle.exportKey('raw', key);
  if (raw.byteLength !== KEY_BYTES) throw new Error('Invalid photo transfer key.');
  return encodeBase64Url(new Uint8Array(raw));
}

export async function importPhotoTransferKey(encodedKey: string) {
  const raw = decodeBase64Url(encodedKey, KEY_BYTES, 'Invalid photo transfer key.');
  return webCrypto().subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPhotoTransferBuffer(
  plaintext: ArrayBuffer,
  key: CryptoKey,
) {
  const iv = new Uint8Array(IV_BYTES);
  webCrypto().getRandomValues(iv);
  const ciphertext = await webCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    plaintext,
  );

  return {
    ciphertext,
    iv: encodeBase64Url(iv),
  };
}

export async function decryptPhotoTransferBuffer(
  ciphertext: ArrayBuffer,
  key: CryptoKey,
  encodedIv: string,
) {
  const iv = decodeBase64Url(encodedIv, IV_BYTES, 'Invalid photo transfer IV.');
  return webCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ciphertext,
  );
}
