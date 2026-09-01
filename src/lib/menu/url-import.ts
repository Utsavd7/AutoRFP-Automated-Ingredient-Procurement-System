import { promises as dns } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import { parse } from 'node-html-parser';

import { MENU_TEXT_BYTES } from '@/lib/menu/menu-input';

export const MENU_URL_IMPORT_BODY_BYTES = 4 * 1_024;
export const MENU_URL_RESPONSE_BYTES = 1 * 1_024 * 1_024;
export const MENU_URL_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_DNS_ANSWERS = 8;
const IMPORT_ERROR =
  'This menu could not be imported safely. Paste the text or upload the file instead.';

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type MenuUrlTransportResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
};
export type MenuUrlImportDependencies = {
  resolve(hostname: string): Promise<ResolvedAddress[]>;
  request(input: {
    url: URL;
    address: ResolvedAddress;
    timeoutMs: number;
    headers: Readonly<Record<string, string>>;
  }): Promise<MenuUrlTransportResponse>;
  now(): number;
};

export class MenuUrlImportError extends Error {
  readonly status = 422;

  constructor() {
    super(IMPORT_ERROR);
    this.name = 'MenuUrlImportError';
  }
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) blockedIpv4.addSubnet(network, prefix, 'ipv4');

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const) blockedIpv6.addSubnet(network, prefix, 'ipv6');

const FIXED_HEADERS = Object.freeze({
  accept: 'text/html,text/plain;q=0.9',
  'user-agent': 'QuotePlate menu importer',
});
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function fail(): never {
  throw new MenuUrlImportError();
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function parseInput(input: unknown) {
  if (!plainRecord(input)) fail();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== 'url' && key !== 'permissionConfirmed') ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return !descriptor?.enumerable || !('value' in descriptor);
    }) ||
    typeof input.url !== 'string' ||
    !input.url ||
    input.url.length > 2_048 ||
    input.permissionConfirmed !== true
  ) fail();
  return input.url;
}

function hostnameWithoutBrackets(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function validPublicAddress(answer: ResolvedAddress) {
  if (!answer || isIP(answer.address) !== answer.family) return false;
  if (answer.family === 4) {
    return !blockedIpv4.check(answer.address, 'ipv4');
  }
  return globalIpv6.check(answer.address, 'ipv6') &&
    !blockedIpv6.check(answer.address, 'ipv6');
}

function safeTarget(value: string | URL) {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    fail();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) fail();
  url.hash = '';
  const hostname = hostnameWithoutBrackets(url.hostname).toLowerCase().replace(/\.$/, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.onion')
  ) fail();
  return { url, hostname };
}

async function pinnedAddress(
  hostname: string,
  resolve: MenuUrlImportDependencies['resolve'],
  timeoutMs: number,
) {
  const literalFamily = isIP(hostname);
  const answers = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await withinTimeout(resolve(hostname), timeoutMs);
  if (
    !Array.isArray(answers) ||
    answers.length === 0 ||
    answers.length > MAX_DNS_ANSWERS ||
    answers.some((answer) => !validPublicAddress(answer))
  ) fail();
  return answers[0]!;
}

async function withinTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MenuUrlImportError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        reject(new MenuUrlImportError());
      },
    );
  });
}

function headerValue(
  headers: MenuUrlTransportResponse['headers'],
  name: string,
) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function decodeUtf8(body: Uint8Array) {
  if (body.byteLength > MENU_URL_RESPONSE_BYTES) fail();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    fail();
  }
}

function normalizeVisibleText(value: string) {
  const normalized = value
    .replace(/\r/g, '')
    .replace(/[\t\f ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!normalized || new TextEncoder().encode(normalized).byteLength > MENU_TEXT_BYTES) {
    fail();
  }
  return normalized;
}

function visibleHtmlText(html: string) {
  const root = parse(html, { comment: false });
  for (const element of root.querySelectorAll(
    'script,style,noscript,template,svg',
  )) element.remove();
  return normalizeVisibleText(root.structuredText);
}

function responseText(response: MenuUrlTransportResponse) {
  if (response.statusCode < 200 || response.statusCode >= 300) fail();
  const encoding = headerValue(response.headers, 'content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') fail();
  const rawContentType = headerValue(response.headers, 'content-type');
  if (!rawContentType) fail();
  const [mime, ...parameters] = rawContentType.toLowerCase().split(';').map((part) => part.trim());
  if (mime !== 'text/html' && mime !== 'text/plain') fail();
  const charset = parameters.find((parameter) => parameter.startsWith('charset='));
  if (charset && charset !== 'charset=utf-8' && charset !== 'charset=us-ascii') fail();
  const decoded = decodeUtf8(response.body);
  return mime === 'text/html'
    ? visibleHtmlText(decoded)
    : normalizeVisibleText(decoded);
}

function canonicalUrl(url: URL) {
  const canonical = new URL(url);
  canonical.search = '';
  canonical.hash = '';
  return canonical.toString();
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));
}

function pinnedLookup(address: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

export function createPinnedHttpsTransport(
  requestFunction: typeof httpsRequest = httpsRequest,
): MenuUrlImportDependencies['request'] {
  return async (input) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const request = requestFunction(input.url, {
      method: 'GET',
      headers: input.headers,
      servername: hostnameWithoutBrackets(input.url.hostname),
      lookup: pinnedLookup(input.address),
    }, (response) => {
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      response.on('data', (chunk: Buffer) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > MENU_URL_RESPONSE_BYTES) {
          response.destroy();
          request.destroy();
          finish(() => reject(new MenuUrlImportError()));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', () => finish(() => reject(new MenuUrlImportError())));
      response.on('end', () => finish(() => resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks, totalBytes),
      })));
    });
    const timer = setTimeout(() => {
      request.destroy();
      finish(() => reject(new MenuUrlImportError()));
    }, input.timeoutMs);
    request.on('error', () => finish(() => reject(new MenuUrlImportError())));
    request.end();
  });
}

const defaultDependencies: MenuUrlImportDependencies = {
  resolve: defaultResolve,
  request: createPinnedHttpsTransport(),
  now: Date.now,
};

export async function importPermittedMenuUrl(
  input: unknown,
  dependencies: MenuUrlImportDependencies = defaultDependencies,
) {
  const urlInput = parseInput(input);
  const deadline = dependencies.now() + MENU_URL_TIMEOUT_MS;
  let current = safeTarget(urlInput);
  let redirects = 0;

  try {
    while (true) {
      const timeoutMs = deadline - dependencies.now();
      if (timeoutMs <= 0) fail();
      const address = await pinnedAddress(
        current.hostname,
        dependencies.resolve,
        timeoutMs,
      );
      const requestTimeoutMs = deadline - dependencies.now();
      if (requestTimeoutMs <= 0) fail();
      const response = await dependencies.request({
        url: current.url,
        address,
        timeoutMs: requestTimeoutMs,
        headers: FIXED_HEADERS,
      });
      if (REDIRECT_STATUS.has(response.statusCode)) {
        const location = headerValue(response.headers, 'location');
        if (!location || redirects >= MAX_REDIRECTS) fail();
        redirects += 1;
        current = safeTarget(new URL(location, current.url));
        continue;
      }
      return {
        menuText: responseText(response),
        canonicalUrl: canonicalUrl(current.url),
      };
    }
  } catch (error) {
    if (error instanceof MenuUrlImportError) throw error;
    throw new MenuUrlImportError();
  }
}
