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
};

const TTL_MS = 30_000;
const cacheableRequests = new Set<string>(Object.values(WORKSPACE_FIRST_REQUESTS));
const responseCache = new Map<string, CacheEntry>();

export function prefetchWorkspace(url: WorkspaceRequest): Promise<void> {
  if (!cacheableRequests.has(url)) return Promise.resolve();
  const current = responseCache.get(url);
  if (current && (current.expiresAt === null || current.expiresAt > Date.now())) {
    return current.response.then(() => undefined);
  }
  if (current) responseCache.delete(url);

  const entry: CacheEntry = {
    expiresAt: null,
    response: Promise.resolve(null),
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
  if (method !== 'GET' || !cacheableRequests.has(url)) return fetch(url, init);

  const current = responseCache.get(url);
  if (!current) return fetch(url, init);
  if (current.expiresAt !== null && current.expiresAt <= Date.now()) {
    responseCache.delete(url);
    return fetch(url, init);
  }

  responseCache.delete(url);
  const response = await current.response;
  return response ? response.clone() : fetch(url, init);
}

export function clearWorkspacePrefetch() {
  responseCache.clear();
}
