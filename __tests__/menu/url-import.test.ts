import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';

import {
  createPinnedHttpsTransport,
  importPermittedMenuUrl,
  MenuUrlImportError,
  type MenuUrlImportDependencies,
  type ResolvedAddress,
} from '@/lib/menu/url-import';

const publicAddress = { address: '93.184.216.34', family: 4 as const };
const nonPublicAnswers: ResolvedAddress[][] = [
  [{ address: '10.0.0.4', family: 4 }],
  [{ address: '169.254.169.254', family: 4 }],
  [{ address: '192.168.1.2', family: 4 }],
  [{ address: 'fe80::1', family: 6 }],
  [publicAddress, { address: '127.0.0.1', family: 4 }],
];

function response(
  body: string | Uint8Array,
  options: { statusCode?: number; contentType?: string; location?: string } = {},
) {
  return {
    statusCode: options.statusCode ?? 200,
    headers: {
      ...(options.contentType === undefined
        ? { 'content-type': 'text/html; charset=utf-8' }
        : { 'content-type': options.contentType }),
      ...(options.location ? { location: options.location } : {}),
    },
    body: typeof body === 'string' ? new TextEncoder().encode(body) : body,
  };
}

function dependencies(
  overrides: Partial<MenuUrlImportDependencies> = {},
): MenuUrlImportDependencies {
  return {
    resolve: jest.fn().mockResolvedValue([publicAddress]),
    request: jest.fn().mockResolvedValue(response('Tomato\nOnion', {
      contentType: 'text/plain; charset=utf-8',
    })),
    now: jest.fn().mockReturnValue(1_000),
    ...overrides,
  };
}

describe('permitted menu URL import', () => {
  it('uses the Node 24 all-address lookup contract and cancels a timed-out transport', async () => {
    jest.useFakeTimers();
    try {
      const events = new EventEmitter();
      const destroy = jest.fn(() => events.emit('error', new Error('cancelled')));
      const end = jest.fn();
      let options: RequestOptions | undefined;
      const requestFunction = (_url: URL, requestOptions: RequestOptions) => {
        options = requestOptions;
        return Object.assign(events, { destroy, end });
      };
      const transport = createPinnedHttpsTransport(requestFunction as never);
      const pending = transport({
        url: new URL('https://restaurant.example/menu'),
        address: publicAddress,
        timeoutMs: 20,
        headers: { accept: 'text/plain' },
      });
      const lookup = options?.lookup as LookupFunction | undefined;
      expect(lookup).toBeDefined();
      await expect(new Promise((resolve, reject) => {
        lookup!('restaurant.example', { all: true } as never, (error, addresses) => {
          if (error) reject(error);
          else resolve(addresses);
        });
      })).resolves.toEqual([publicAddress]);

      const rejection = expect(pending).rejects.toBeInstanceOf(MenuUrlImportError);
      await jest.advanceTimersByTimeAsync(21);
      await rejection;
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('requires explicit permission before DNS or network work', async () => {
    const deps = dependencies();
    await expect(importPermittedMenuUrl({
      url: 'https://restaurant.example/menu',
      permissionConfirmed: false,
    }, deps)).rejects.toBeInstanceOf(MenuUrlImportError);
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.request).not.toHaveBeenCalled();
  });

  test.each([
    'http://restaurant.example/menu',
    'https://user:secret@restaurant.example/menu',
    'https://restaurant.example:8443/menu',
    'https://localhost/menu',
    'https://kitchen.local/menu',
    'https://127.0.0.1/menu',
    'https://[::1]/menu',
  ])('rejects unsafe target %s before transport', async (url) => {
    const deps = dependencies();
    await expect(importPermittedMenuUrl({
      url,
      permissionConfirmed: true,
    }, deps)).rejects.toBeInstanceOf(MenuUrlImportError);
    expect(deps.request).not.toHaveBeenCalled();
  });

  test.each(nonPublicAnswers)(
    'rejects a DNS result containing a non-public address',
    async (answers) => {
    const deps = dependencies({ resolve: jest.fn().mockResolvedValue(answers) });
    await expect(importPermittedMenuUrl({
      url: 'https://restaurant.example/menu', permissionConfirmed: true,
    }, deps)).rejects.toBeInstanceOf(MenuUrlImportError);
    expect(deps.request).not.toHaveBeenCalled();
    },
  );

  it('pins the validated address, strips ambient headers, and revalidates redirects', async () => {
    const resolve = jest.fn()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: '151.101.1.69', family: 4 }]);
    const request = jest.fn()
      .mockResolvedValueOnce(response('', {
        statusCode: 302,
        location: 'https://cdn.restaurant.example/final?campaign=1',
      }))
      .mockResolvedValueOnce(response(`
        <html><body><h1>Breakfast Menu</h1>
        <script>stealCookies()</script><style>.secret{}</style>
        <p>Masala dosa</p><noscript>hidden</noscript>
        <template>not visible</template><svg><text>not a dish</text></svg>
        </body></html>
      `));
    const deps = dependencies({ resolve, request });

    await expect(importPermittedMenuUrl({
      url: 'https://restaurant.example/menu?source=owner#section',
      permissionConfirmed: true,
    }, deps)).resolves.toEqual({
      menuText: 'Breakfast Menu\nMasala dosa',
      canonicalUrl: 'https://cdn.restaurant.example/final',
    });
    expect(resolve).toHaveBeenNthCalledWith(1, 'restaurant.example');
    expect(resolve).toHaveBeenNthCalledWith(2, 'cdn.restaurant.example');
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      address: publicAddress,
      headers: {
        accept: 'text/html,text/plain;q=0.9',
        'user-agent': 'QuotePlate menu importer',
      },
    }));
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/cookie|authorization|referer/i);
  });

  it('blocks a redirect that resolves privately and stops after three redirects', async () => {
    const privateRedirect = dependencies({
      resolve: jest.fn()
        .mockResolvedValueOnce([publicAddress])
        .mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]),
      request: jest.fn().mockResolvedValue(response('', {
        statusCode: 302, location: 'https://private.example/menu',
      })),
    });
    await expect(importPermittedMenuUrl({
      url: 'https://restaurant.example/menu', permissionConfirmed: true,
    }, privateRedirect)).rejects.toBeInstanceOf(MenuUrlImportError);
    expect(privateRedirect.request).toHaveBeenCalledTimes(1);

    const redirects = dependencies({
      request: jest.fn().mockResolvedValue(response('', {
        statusCode: 302, location: '/again',
      })),
    });
    await expect(importPermittedMenuUrl({
      url: 'https://restaurant.example/menu', permissionConfirmed: true,
    }, redirects)).rejects.toBeInstanceOf(MenuUrlImportError);
    expect(redirects.request).toHaveBeenCalledTimes(4);
  });

  test.each([
    ['an executable MIME', response('alert(1)', { contentType: 'application/javascript' })],
    ['invalid UTF-8', response(new Uint8Array([0xc3, 0x28]), { contentType: 'text/plain' })],
    ['more than one MiB', response(new Uint8Array(1_048_577), { contentType: 'text/plain' })],
    ['a failed status', response('not found', { statusCode: 404 })],
  ])('rejects %s with the same safe import error', async (_label, result) => {
    const deps = dependencies({ request: jest.fn().mockResolvedValue(result) });
    await expect(importPermittedMenuUrl({
      url: 'https://restaurant.example/menu', permissionConfirmed: true,
    }, deps)).rejects.toEqual(expect.objectContaining({
      name: 'MenuUrlImportError',
      message: 'This menu could not be imported safely. Paste the text or upload the file instead.',
    }));
  });
});
