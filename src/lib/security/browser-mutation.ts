export type BrowserMutationRejection = 'CROSS_ORIGIN' | 'UNSUPPORTED_MEDIA_TYPE';

type BrowserMutationEnvironment = Readonly<Record<string, string | undefined>>;

function addOrigin(origins: Set<string>, value: string | undefined) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username && !url.password
    ) origins.add(url.origin);
  } catch {
    // Invalid candidates are never trusted.
  }
}

function trustedRequestOrigins(
  request: Request,
  environment: BrowserMutationEnvironment,
) {
  const origins = new Set<string>();
  const requestUrl = new URL(request.url);
  origins.add(requestUrl.origin);
  addOrigin(origins, environment.NEXTAUTH_URL?.trim());

  const host = request.headers.get('host')?.trim();
  if (host && !/[\s/\\@]/.test(host)) {
    addOrigin(origins, `${requestUrl.protocol}//${host}`);
    const forwardedProtocol = request.headers
      .get('x-forwarded-proto')
      ?.split(',', 1)[0]
      ?.trim()
      .toLowerCase();
    if (forwardedProtocol === 'http' || forwardedProtocol === 'https') {
      addOrigin(origins, `${forwardedProtocol}://${host}`);
    }
  }
  return origins;
}

export function browserMutationOriginRejection(
  request: Request,
  environment: BrowserMutationEnvironment = process.env,
): 'CROSS_ORIGIN' | null {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  let normalizedOrigin: string | null = null;
  if (origin !== null) {
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      return 'CROSS_ORIGIN';
    }
  }

  if (
    (normalizedOrigin !== null && !trustedRequestOrigins(request, environment).has(normalizedOrigin)) ||
    (fetchSite !== undefined && fetchSite !== 'same-origin')
  ) {
    return 'CROSS_ORIGIN';
  }
  return null;
}

export function browserJsonMutationRejection(
  request: Request,
  environment: BrowserMutationEnvironment = process.env,
): BrowserMutationRejection | null {
  const originRejection = browserMutationOriginRejection(request, environment);
  if (originRejection) return originRejection;

  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  return mediaType === 'application/json' ? null : 'UNSUPPORTED_MEDIA_TYPE';
}

export function privateMutationResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
