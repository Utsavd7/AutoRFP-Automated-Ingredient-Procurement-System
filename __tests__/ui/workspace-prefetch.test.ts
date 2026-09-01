import {
  clearWorkspacePrefetch,
  prefetchWorkspace,
  workspaceFetch,
} from '@/lib/client/workspace-prefetch';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const overviewUrl = '/api/overview';

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('workspace prefetch', () => {
  beforeEach(() => {
    clearWorkspacePrefetch();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    clearWorkspacePrefetch();
    jest.useRealTimers();
  });

  it('reuses a prefetched response exactly once', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ source: 'prefetch' }))
      .mockResolvedValueOnce(jsonResponse({ source: 'network' }));

    await prefetchWorkspace(overviewUrl);

    const prefetched = await workspaceFetch(overviewUrl, { cache: 'no-store' });
    const fresh = await workspaceFetch(overviewUrl, { cache: 'no-store' });

    await expect(prefetched.json()).resolves.toEqual({ source: 'prefetch' });
    await expect(fresh.json()).resolves.toEqual({ source: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps response clones independently readable', async () => {
    const networkResponse = jsonResponse({ source: 'prefetch' });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(networkResponse);

    await prefetchWorkspace(overviewUrl);
    const cachedResponse = await workspaceFetch(overviewUrl);

    await expect(networkResponse.json()).resolves.toEqual({ source: 'prefetch' });
    await expect(cachedResponse.json()).resolves.toEqual({ source: 'prefetch' });
  });

  it('deduplicates duplicate in-flight prefetches', async () => {
    let resolveFetch!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValue(pendingResponse);

    const first = prefetchWorkspace(overviewUrl);
    const second = prefetchWorkspace(overviewUrl);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse({ ok: true }));
    await Promise.all([first, second]);
  });

  it('keeps a slow in-flight prefetch deduplicated beyond the response TTL window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    let resolveFetch!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValue(pendingResponse);

    const first = prefetchWorkspace(overviewUrl);
    jest.setSystemTime(new Date('2026-09-01T00:00:31.000Z'));
    const second = prefetchWorkspace(overviewUrl);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse({ ok: true }));
    await Promise.all([first, second]);
  });

  it('ignores requests outside the private first-page allowlist', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    await prefetchWorkspace('/api/account' as typeof overviewUrl);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not reuse a prefetched response after the 30 second TTL', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ source: 'expired' }))
      .mockResolvedValueOnce(jsonResponse({ source: 'network' }));

    await prefetchWorkspace(overviewUrl);
    jest.setSystemTime(new Date('2026-09-01T00:00:30.001Z'));

    const response = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ source: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed prefetch and lets the normal fetch retry', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'Unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ source: 'retry' }));

    await prefetchWorkspace(overviewUrl);
    const response = await workspaceFetch(overviewUrl);

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ source: 'retry' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forces a fresh request after explicit invalidation', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ source: 'prefetch' }))
      .mockResolvedValueOnce(jsonResponse({ source: 'network' }));

    await prefetchWorkspace(overviewUrl);
    clearWorkspacePrefetch();
    const response = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ source: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prefetches sidebar destinations on intent and warms them once while idle', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );

    expect(source).toContain('onPointerEnter={() => void prefetchWorkspace');
    expect(source).toContain('onFocus={() => void prefetchWorkspace');
    expect(source).toContain("document.visibilityState !== 'visible'");
    expect(source).toContain("document.addEventListener('visibilitychange', onVisibilityChange)");
    expect(source).toContain("document.removeEventListener('visibilitychange', onVisibilityChange)");
    expect(source).toContain('if (warmed || scheduled || document.visibilityState');
    expect(source).toContain('warmed = true');
    expect(source).toContain('requestIdleCallback');
    expect(source).toContain('cancelIdleCallback');
  });

  it('uses prefetched responses only from procurement and menu initial effects', () => {
    const procurement = readFileSync(
      join(process.cwd(), 'src', 'components', 'procurement', 'ProcurementWorkspace.tsx'),
      'utf8',
    );
    const menus = readFileSync(
      join(process.cwd(), 'src', 'components', 'menus', 'MenuWorkspace.tsx'),
      'utf8',
    );

    expect(procurement).toContain('async (cursor?: string, usePrefetch = false)');
    expect(procurement).toContain('void loadRequests(undefined, true)');
    expect(procurement).toContain('usePrefetch\n        ? workspaceFetch');
    expect(procurement).toContain('onClick={() => void loadRequests()}>Try again');
    expect(menus).toContain('async (cursor?: string, usePrefetch = false)');
    expect(menus).toContain('void loadMenus(undefined, true)');
    expect(menus).toContain('usePrefetch\n        ? workspaceFetch');
    expect(menus).toContain('onClick={() => void loadMenus()}>Try again');
  });

  it('uses the prefetched response only for each matching first page', () => {
    const expected = [
      ['src/components/overview/OverviewWorkspace.tsx', "workspaceFetch('/api/overview'"],
      ['src/components/procurement/ProcurementWorkspace.tsx', "workspaceFetch('/api/requests?limit=50'"],
      ['src/components/menus/MenuWorkspace.tsx', "workspaceFetch('/api/menus?limit=50'"],
      ['src/components/suppliers/SupplierWorkspace.tsx', "workspaceFetch('/api/suppliers?active=true&limit=50'"],
      ['src/components/reporting/InsightsWorkspace.tsx', "workspaceFetch('/api/insights'"],
      ['src/components/reporting/HistoryWorkspace.tsx', "workspaceFetch('/api/history?limit=25'"],
      ['src/components/settings/SettingsWorkspace.tsx', "workspaceFetch('/api/settings'"],
    ] as const;

    for (const [file, call] of expected) {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain(call);
    }
  });
});
