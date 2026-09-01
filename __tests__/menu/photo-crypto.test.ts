import {
  decryptPhotoTransferBuffer,
  encryptPhotoTransferBuffer,
  exportPhotoTransferKey,
  generatePhotoTransferKey,
  importPhotoTransferKey,
} from '@/lib/menu/photo-crypto';

describe('browser photo transfer crypto', () => {
  it('exports, imports, encrypts, and decrypts an AES-GCM 256 key', async () => {
    const plaintext = new TextEncoder().encode('a private menu image').buffer;
    const generatedKey = await generatePhotoTransferKey();
    const exportedKey = await exportPhotoTransferKey(generatedKey);
    const importedKey = await importPhotoTransferKey(exportedKey);
    const encrypted = await encryptPhotoTransferBuffer(plaintext, importedKey);

    expect(exportedKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(encrypted.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(encrypted.ciphertext.byteLength).toBe(plaintext.byteLength + 16);
    await expect(decryptPhotoTransferBuffer(
      encrypted.ciphertext,
      importedKey,
      encrypted.iv,
    )).resolves.toEqual(plaintext);
  });

  it('rejects tampered ciphertext and malformed key or IV encodings', async () => {
    const key = await generatePhotoTransferKey();
    const encrypted = await encryptPhotoTransferBuffer(new Uint8Array([1, 2, 3]).buffer, key);
    const tampered = new Uint8Array(encrypted.ciphertext.slice(0));
    tampered[0] ^= 1;

    await expect(decryptPhotoTransferBuffer(tampered.buffer, key, encrypted.iv)).rejects.toThrow();
    await expect(importPhotoTransferKey('A'.repeat(42))).rejects.toThrow('Invalid photo transfer key.');
    await expect(importPhotoTransferKey(`${'A'.repeat(43)}=`)).rejects.toThrow('Invalid photo transfer key.');
    await expect(decryptPhotoTransferBuffer(encrypted.ciphertext, key, 'A'.repeat(15)))
      .rejects.toThrow('Invalid photo transfer IV.');
  });
});
