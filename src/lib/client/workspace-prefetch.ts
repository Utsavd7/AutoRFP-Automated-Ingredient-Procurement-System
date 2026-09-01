export const WORKSPACE_FIRST_REQUESTS = {
  '/dashboard': '/api/overview',
  '/procurement': '/api/requests?limit=50',
  '/menus': '/api/menus?limit=50',
  '/suppliers': '/api/suppliers?active=true&limit=50',
  '/insights': '/api/insights',
  '/history': '/api/history?limit=25',
  '/settings': '/api/settings',
} as const;

type WorkspaceRequest = (typeof WORKSPACE_FIRST_REQUESTS)[keyof typeof WORKSPACE_FIRST_REQUESTS];
type CacheEntry = {
  expiresAt: number | null;
  response: Promise<Response | null>;
  scope: string;
};

const TTL_MS = 30_000;
const WARM_CONCURRENCY = 2;
const cacheableRequests = new Set<string>(Object.values(WORKSPACE_FIRST_REQUESTS));
const responseCache = new Map<string, CacheEntry>();
let activeWorkspaceScope: string | null = null;

export function setWorkspacePrefetchScope(scope: string | null) {
  if (activeWorkspaceScope === scope) return;
  activeWorkspaceScope = scope;
  responseCache.clear();
}

export function prefetchWorkspace(url: WorkspaceRequest): Promise<void> {
  const scope = activeWorkspaceScope;
  if (!scope || !cacheableRequests.has(url)) return Promise.resolve();
  const current = responseCache.get(url);
  if (
    current?.scope === scope &&
    (current.expiresAt === null || current.expiresAt > Date.now())
  ) {
    return current.response.then(() => undefined);
  }
  if (current) responseCache.delete(url);

  const entry: CacheEntry = {
    expiresAt: null,
    response: Promise.resolve(null),
    scope,
  };
  entry.response = fetch(url, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) {
        if (responseCache.get(url) === entry) responseCache.delete(url);
        return null;
      }
      entry.expiresAt = Date.now() + TTL_MS;
      return response.clone();
    })
    .catch(() => {
      if (responseCache.get(url) === entry) responseCache.delete(url);
      return null;
    });
  responseCache.set(url, entry);
  return entry.response.then(() => undefined);
}

export async function workspaceFetch(
  url: WorkspaceRequest,
  init?: RequestInit,
): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const scope = activeWorkspaceScope;
  if (!scope || method !== 'GET' || !cacheableRequests.has(url)) return fetch(url, init);

  const current = responseCache.get(url);
  if (!current || current.scope !== scope) return fetch(url, init);
  if (current.expiresAt !== null && current.expiresAt <= Date.now()) {
    responseCache.delete(url);
    return fetch(url, init);
  }

  responseCache.delete(url);
  const response = await current.response;
  return response && activeWorkspaceScope === current.scope
    ? response.clone()
    : fetch(url, init);
}

export function clearWorkspacePrefetch() {
  responseCache.clear();
}

export async function workspaceMutationFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && response.ok) clearWorkspacePrefetch();
  return response;
}

export async function warmWorkspacePrefetch(pathname: string): Promise<void> {
  const requests = Object.entries(WORKSPACE_FIRST_REQUESTS)
    .filter(([route]) => pathname !== route && !pathname.startsWith(`${route}/`))
    .map(([, url]) => url);
  let nextRequest = 0;
  const worker = async () => {
    while (nextRequest < requests.length) {
      const url = requests[nextRequest];
      nextRequest += 1;
      await prefetchWorkspace(url);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WARM_CONCURRENCY, requests.length) }, worker),
  );
}
