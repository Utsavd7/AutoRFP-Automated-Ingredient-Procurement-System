import {
  consumePhoneTransferFragment,
  createLaptopPhotoTransfer,
  receiveLaptopPhotoTransfer,
  sendPhonePhotoBatch,
} from '@/lib/menu/photo-transfer-client';
import {
  encryptPhotoTransferBuffer,
  generatePhotoTransferKey,
} from '@/lib/menu/photo-crypto';
import { parsePhotoTransferMetadataHeader } from '@/lib/menu/photo-transfer-contract';

function imageFile(name: string, contents: string) {
  return new File([contents], name, { type: 'image/jpeg' });
}

describe('menu photo transfer browser client', () => {
  it('creates a transfer and puts both secrets in the fragment only', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      token: 'signed-transfer-token',
      expiresAt: Date.now() + 15 * 60_000,
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }));

    const created = await createLaptopPhotoTransfer({
      origin: 'https://quoteplate.example',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('/api/menu-photo-transfer', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'create' }),
    }));
    const url = new URL(created.captureUrl);
    expect(url.pathname).toBe('/menu-capture');
    expect(url.search).toBe('');
    expect(url.hash).toContain('token=signed-transfer-token');
    expect(url.hash).toMatch(/key=[A-Za-z0-9_-]{43}/);
    expect(url.searchParams.has('token')).toBe(false);
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('reads the phone link once and immediately removes its fragment', async () => {
    const key = await generatePhotoTransferKey();
    const raw = await crypto.subtle.exportKey('raw', key);
    const encoded = Buffer.from(raw).toString('base64url');
    const replaceState = jest.fn();

    const session = await consumePhoneTransferFragment({
      hash: `#token=phone-token&key=${encoded}`,
      pathname: '/menu-capture',
      search: '',
      replaceState,
    });

    expect(session.token).toBe('phone-token');
    expect(session.key).toBeDefined();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/menu-capture');
  });

  it('rejects ambiguous duplicate fragment secrets after clearing them', async () => {
    const key = Buffer.alloc(32, 4).toString('base64url');
    const replaceState = jest.fn();

    await expect(consumePhoneTransferFragment({
      hash: `#token=first&token=second&key=${key}`,
      pathname: '/menu-capture',
      search: '',
      replaceState,
    })).rejects.toThrow('Invalid phone transfer link.');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/menu-capture');
  });

  it('encrypts and uploads photos sequentially with bearer-only auth and exact completion', async () => {
    const key = await generatePhotoTransferKey();
    const photos = [imageFile('front.jpg', 'front'), imageFile('back.jpg', 'back')];
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await Promise.resolve();
      calls.push({ url: String(url), init: init ?? {} });
      inFlight -= 1;
      return new Response(JSON.stringify({ status: 'complete' }), {
        status: init?.method === 'PUT' ? 201 : 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const progress: string[] = [];

    await sendPhonePhotoBatch({
      files: photos,
      token: 'phone-token',
      key,
      fetchImpl,
      readDimensions: async () => ({ width: 1200, height: 1600 }),
      onProgress: ({ message }) => progress.push(message),
    });

    expect(maximumInFlight).toBe(1);
    expect(calls.map(({ url }) => url)).toEqual([
      '/api/menu-photo-transfer/upload',
      '/api/menu-photo-transfer/upload',
      '/api/menu-photo-transfer/upload',
    ]);
    for (const [index, call] of calls.slice(0, 2).entries()) {
      const headers = new Headers(call.init.headers);
      expect(call.init.method).toBe('PUT');
      expect(headers.get('authorization')).toBe('Bearer phone-token');
      expect(headers.get('content-type')).toBe('application/octet-stream');
      expect(headers.get('x-photo-transfer-metadata')).toBeTruthy();
      expect(String(call.url)).not.toContain('phone-token');
      expect(parsePhotoTransferMetadataHeader(
        headers.get('x-photo-transfer-metadata'),
      )).toMatchObject({ index, name: photos[index].name });
    }
    const complete = calls[2];
    expect(new Headers(complete.init.headers).get('authorization')).toBe('Bearer phone-token');
    expect(complete.init.body).toBe(JSON.stringify({ action: 'complete' }));
    expect(progress).toEqual(['Sending photo 1 of 2', 'Sending photo 2 of 2']);
  });

  it('downloads, decrypts, validates, saves locally, and only then sends a receipt', async () => {
    const key = await generatePhotoTransferKey();
    const originals = [imageFile('one.jpg', 'one'), imageFile('two.jpg', 'two')];
    const encrypted = await Promise.all(originals.map(async (file, index) => {
      const result = await encryptPhotoTransferBuffer(await file.arrayBuffer(), key);
      return {
        ciphertext: result.ciphertext,
        metadata: {
          index,
          name: file.name,
          type: 'image/jpeg' as const,
          size: file.size,
          encryptedSize: result.ciphertext.byteLength,
          iv: result.iv,
        },
      };
    }));
    const events: string[] = [];
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { action: string; index?: number } : null;
      if (body?.action === 'download') {
        events.push(`download-${body.index}`);
        return new Response(encrypted[body.index!].ciphertext, { status: 200 });
      }
      events.push('receipt');
      return new Response(null, { status: 204 });
    });
    const saveBatch = jest.fn(async (batch: { files: File[] }) => {
      events.push('save');
      await expect(Promise.all(batch.files.map((file) => file.text())))
        .resolves.toEqual(['one', 'two']);
    });

    const received = await receiveLaptopPhotoTransfer({
      token: 'laptop-token',
      key,
      workspaceId: 'workspace-a',
      metadata: encrypted.map(({ metadata }) => metadata),
      fetchImpl,
      readDimensions: async () => ({ width: 800, height: 600 }),
      saveBatch,
      createBatchId: () => 'batch-a',
    });

    expect(received.batchId).toBe('batch-a');
    expect(events).toEqual(['download-0', 'download-1', 'save', 'receipt']);
    expect(fetchImpl).toHaveBeenLastCalledWith('/api/menu-photo-transfer', expect.objectContaining({
      body: JSON.stringify({ action: 'receipt', token: 'laptop-token' }),
    }));
  });

  it('keeps decrypted files available and does not send a receipt if local saving fails', async () => {
    const key = await generatePhotoTransferKey();
    const original = imageFile('menu.jpg', 'menu');
    const encrypted = await encryptPhotoTransferBuffer(await original.arrayBuffer(), key);
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.action !== 'download') throw new Error('Receipt must not be sent.');
      return new Response(encrypted.ciphertext, { status: 200 });
    });

    await expect(receiveLaptopPhotoTransfer({
      token: 'laptop-token',
      key,
      workspaceId: 'workspace-a',
      metadata: [{
        index: 0,
        name: original.name,
        type: 'image/jpeg',
        size: original.size,
        encryptedSize: encrypted.ciphertext.byteLength,
        iv: encrypted.iv,
      }],
      fetchImpl,
      readDimensions: async () => ({ width: 800, height: 600 }),
      saveBatch: async () => { throw new Error('IndexedDB unavailable'); },
      createBatchId: () => 'batch-a',
    })).rejects.toMatchObject({
      name: 'LocalPhotoPersistenceError',
      files: [expect.objectContaining({ name: 'menu.jpg' })],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports durable local files separately when only the receipt fails', async () => {
    const key = await generatePhotoTransferKey();
    const original = imageFile('saved.jpg', 'saved');
    const encrypted = await encryptPhotoTransferBuffer(await original.arrayBuffer(), key);
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.action === 'download') {
        return new Response(encrypted.ciphertext, { status: 200 });
      }
      return new Response('Temporary transfer could not be cleared.', { status: 503 });
    });

    await expect(receiveLaptopPhotoTransfer({
      token: 'laptop-token',
      key,
      workspaceId: 'workspace-a',
      metadata: [{
        index: 0,
        name: original.name,
        type: 'image/jpeg',
        size: original.size,
        encryptedSize: encrypted.ciphertext.byteLength,
        iv: encrypted.iv,
      }],
      fetchImpl,
      readDimensions: async () => ({ width: 800, height: 600 }),
      saveBatch: async () => {},
      createBatchId: () => 'batch-saved',
    })).rejects.toMatchObject({
      name: 'PhotoTransferReceiptError',
      batchId: 'batch-saved',
      files: [expect.objectContaining({ name: 'saved.jpg' })],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('turns rate limits and plain response bodies into useful errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(
      'Please wait before making another code.',
      { status: 429, headers: { 'retry-after': '60' } },
    ));

    await expect(createLaptopPhotoTransfer({
      origin: 'https://quoteplate.example',
      fetchImpl,
    })).rejects.toThrow('Please wait before making another code. Try again in 60 seconds.');
  });

  it('reads RFC problem details for rate limits without showing raw JSON', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      type: 'about:blank',
      status: 429,
      title: 'Too many photo transfer attempts',
      detail: 'Too many photo transfer attempts were made. Try again later.',
    }), {
      status: 429,
      headers: {
        'content-type': 'application/problem+json',
        'retry-after': '90',
      },
    }));

    await expect(createLaptopPhotoTransfer({
      origin: 'https://quoteplate.example',
      fetchImpl,
    })).rejects.toThrow(
      'Too many photo transfer attempts were made. Try again later. Try again in 90 seconds.',
    );
  });
});
