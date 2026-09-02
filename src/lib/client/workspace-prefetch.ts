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
  expiresAt: number;
  response: Response | null;
  refresh: Promise<Response> | null;
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

function startWorkspaceRefresh(
  url: WorkspaceRequest,
  scope: string,
  init?: RequestInit,
): Promise<Response> {
  const current = responseCache.get(url);
  const entry = current?.scope === scope
    ? current
    : {
        expiresAt: 0,
        response: null,
        refresh: null,
        scope,
      };

  if (entry.refresh) return entry.refresh;
  if (entry !== current) responseCache.set(url, entry);

  const refresh = fetch(url, init)
    .then((response) => {
      if (
        response.ok &&
        activeWorkspaceScope === scope &&
        responseCache.get(url) === entry
      ) {
        entry.response = response.clone();
        entry.expiresAt = Date.now() + TTL_MS;
      } else if (!response.ok && !entry.response && responseCache.get(url) === entry) {
        responseCache.delete(url);
      }
      return response;
    })
    .catch((error: unknown) => {
      if (!entry.response && responseCache.get(url) === entry) {
        responseCache.delete(url);
      }
      throw error;
    })
    .finally(() => {
      if (responseCache.get(url) === entry && entry.refresh === refresh) {
        entry.refresh = null;
      }
    });
  entry.refresh = refresh;
  return refresh;
}

export async function prefetchWorkspace(url: WorkspaceRequest): Promise<void> {
  const scope = activeWorkspaceScope;
  if (!scope || !cacheableRequests.has(url)) return;

  const current = responseCache.get(url);
  if (current?.scope === scope && current.response && current.expiresAt > Date.now()) return;

  try {
    await startWorkspaceRefresh(url, scope, { cache: 'no-store' });
  } catch {
    // Prefetching is opportunistic; the normal request path may retry.
  }
}

export async function workspaceFetch(
  url: WorkspaceRequest,
  init?: RequestInit,
): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const scope = activeWorkspaceScope;
  if (!scope || method !== 'GET' || !cacheableRequests.has(url)) return fetch(url, init);

  const current = responseCache.get(url);
  if (current?.scope === scope && current.response) {
    if (current.expiresAt > Date.now()) return current.response.clone();

    void startWorkspaceRefresh(url, scope, init).catch(() => undefined);
    return current.response.clone();
  }

  const response = await startWorkspaceRefresh(url, scope, init);
  if (activeWorkspaceScope !== scope) return workspaceFetch(url, init);
  return response.clone();
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
