# Workspace Navigation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeat navigation between QuotePlate sidebar pages feel immediate by retaining the latest successful browser response and refreshing expired data in the background.

**Architecture:** Replace the one-use response promise in the existing allowlisted workspace helper with a tiny per-URL cache entry containing the last successful cloned response, its expiry, and at most one refresh promise. Keep all page components and API contracts unchanged; clear the cache at the existing mutation, workspace, and sign-out boundaries.

**Tech Stack:** Next.js 16, React 19, TypeScript, browser Fetch API, Jest 30.

---

## Boundaries

- No new dependency, state library, service worker, server cache, database storage, API, hosting product, or paid feature.
- Keep the existing seven first-page URL allowlist and 30-second freshness period.
- Search, pagination, detail URLs, non-GET requests, and unsuccessful responses stay uncached.
- Never let a response from one workspace scope repopulate or appear in another workspace.
- A failed background refresh must not discard the last successful response.

### Task 1: Rewrite the cache contract as failing tests

**Files:**
- Modify: `__tests__/ui/workspace-prefetch.test.ts`
- Test: `__tests__/ui/workspace-prefetch.test.ts`

- [ ] **Step 1: Change the one-use expectation to fresh reusable reads**

Replace `reuses a prefetched response exactly once` with:

```ts
it('reuses a fresh successful response for repeated reads', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValue(jsonResponse({ source: 'network' }));

  await prefetchWorkspace(overviewUrl);
  const first = await workspaceFetch(overviewUrl);
  const second = await workspaceFetch(overviewUrl);

  await expect(first.json()).resolves.toEqual({ source: 'network' });
  await expect(second.json()).resolves.toEqual({ source: 'network' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Add a normal-fetch cache population test**

Call `workspaceFetch` twice without prefetching, read both bodies, and assert one network request.

- [ ] **Step 3: Replace the expired-response test with stale-while-refresh behavior**

Use fake time and a manually resolved second fetch. After 30 seconds, assert the expired read returns the prior body before the refresh resolves, then resolve the refresh, await `prefetchWorkspace(overviewUrl)`, and assert the next read contains refreshed data.

- [ ] **Step 4: Add concurrent-expiry and failed-refresh tests**

For concurrent expiry, issue two expired reads before resolving the refresh and assert one refresh request. For failure, reject the refresh and assert the stale response remains readable and a later expired call can retry.

- [ ] **Step 5: Retain and strengthen the existing boundary tests**

Keep tests for mutation invalidation, scope switch, null scope, first-page allowlist, non-GET bypass, in-flight prefetch deduplication, idle warm concurrency, and sign-out. Add an assertion that an in-flight response started in workspace A cannot populate the cache after switching to workspace B.

- [ ] **Step 6: Run the focused test and confirm the old one-use implementation fails**

Run: `npm test -- --runTestsByPath __tests__/ui/workspace-prefetch.test.ts`

Expected: FAIL on repeat reuse, normal-fetch population, and stale-while-refresh cases.

- [ ] **Step 7: Commit the red test**

```bash
git add __tests__/ui/workspace-prefetch.test.ts
git commit -m "test: define instant repeat workspace navigation"
```

### Task 2: Implement the minimal reusable response cache

**Files:**
- Modify: `src/lib/client/workspace-prefetch.ts`
- Test: `__tests__/ui/workspace-prefetch.test.ts`

- [ ] **Step 1: Replace the cache entry with response plus shared refresh state**

```ts
type CacheEntry = {
  expiresAt: number;
  refresh: Promise<Response> | null;
  response: Response | null;
  scope: string;
};
```

- [ ] **Step 2: Add one internal refresh starter**

```ts
function startWorkspaceRefresh(
  url: WorkspaceRequest,
  scope: string,
  init?: RequestInit,
): Promise<Response> {
  let entry = responseCache.get(url);
  if (!entry || entry.scope !== scope) {
    entry = { expiresAt: 0, refresh: null, response: null, scope };
    responseCache.set(url, entry);
  }
  if (entry.refresh) return entry.refresh;

  let refresh!: Promise<Response>;
  refresh = fetch(url, init)
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
    .catch((error) => {
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
```

The identity and active-scope checks are mandatory because clearing a map cannot cancel a request already in flight.

- [ ] **Step 3: Make prefetch reuse fresh data and share refreshes**

Return immediately for a fresh successful response; otherwise await `startWorkspaceRefresh(url, scope, { cache: 'no-store' })`, swallowing prefetch-only failures as the current public contract does.

- [ ] **Step 4: Make normal GETs populate and reuse the cache**

For cacheable scoped GETs:

```ts
const current = responseCache.get(url);
if (current?.scope === scope && current.response) {
  if (current.expiresAt <= Date.now()) {
    void startWorkspaceRefresh(url, scope, init).catch(() => undefined);
  }
  return current.response.clone();
}
const response = await startWorkspaceRefresh(url, scope, init);
return activeWorkspaceScope === scope ? response.clone() : fetch(url, init);
```

Continue to call `fetch` directly for unknown URLs, missing scope, and non-GET requests. Do not cache a non-OK response.

- [ ] **Step 5: Keep invalidation and warming APIs unchanged**

`setWorkspacePrefetchScope`, `clearWorkspacePrefetch`, `workspaceMutationFetch`, and `warmWorkspacePrefetch` keep their signatures. A successful non-GET mutation still clears all entries.

- [ ] **Step 6: Run the focused test**

Run: `npm test -- --runTestsByPath __tests__/ui/workspace-prefetch.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the cache implementation**

```bash
git add src/lib/client/workspace-prefetch.ts __tests__/ui/workspace-prefetch.test.ts
git commit -m "perf: make repeat workspace navigation immediate"
```

### Task 3: Verify navigation speed and all safety boundaries

**Files:**
- Verify: `src/lib/client/workspace-prefetch.ts`
- Verify: `__tests__/ui/workspace-prefetch.test.ts`

- [ ] **Step 1: Run the focused test three times to catch promise and timer races**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/workspace-prefetch.test.ts
npm test -- --runTestsByPath __tests__/ui/workspace-prefetch.test.ts
npm test -- --runTestsByPath __tests__/ui/workspace-prefetch.test.ts
```

Expected: all three runs pass.

- [ ] **Step 2: Run complete project checks**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Measure live repeat navigation**

With an authenticated local workspace, open each sidebar destination once, then revisit Menus, Suppliers, Insights, History, and Settings. Confirm repeat clicks show content immediately from the last successful response and the background refresh does not replace the page with a skeleton.

- [ ] **Step 4: Verify invalidation live**

Make one successful edit and confirm the next affected list navigation fetches current data. Sign out and sign into another workspace and confirm no prior workspace data is visible.

- [ ] **Step 5: Inspect scope and cost**

Run: `git diff --check && git status --short && git diff -- package.json prisma/schema.prisma`

Expected: no whitespace errors; no package or schema diff; no new network service or billing configuration. Preserve `chroma_data/` and `scripts/show-tables.sh` without staging them.

- [ ] **Step 6: Commit any verification-only correction**

Only if verification required a real code correction:

```bash
git add src/lib/client/workspace-prefetch.ts __tests__/ui/workspace-prefetch.test.ts
git commit -m "fix: finish navigation cache verification"
```
