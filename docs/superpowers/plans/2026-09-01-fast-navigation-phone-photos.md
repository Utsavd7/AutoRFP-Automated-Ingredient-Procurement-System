# Fast Navigation and Phone Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make signed-in navigation feel immediate and transfer up to ten menu photos from a phone into the open laptop menu workflow without adding database schema or paid services.

**Architecture:** A tiny browser-memory response cache warms only the first bounded GET behind each sidebar route and is invalidated after writes. A signed, fifteen-minute phone session uses client-side AES-GCM encryption and the existing Netlify project Blob store for temporary ciphertext; the receiving laptop decrypts and keeps review copies in IndexedDB, then the server deletes the temporary batch.

**Tech Stack:** Next.js 16, React 19, TypeScript, Web Crypto, IndexedDB, `@netlify/blobs`, Jest, Playwright.

---

## File map

- Create `src/lib/client/workspace-prefetch.ts`: short-lived, browser-memory GET prefetch and invalidation.
- Modify `src/app/(app)/layout.tsx`: prefetch the matching API on pointer, focus, and idle after account readiness.
- Modify the seven top-level workspace components: consume the warmed first request and invalidate after mutations.
- Create `src/lib/menu/photo-transfer.ts`: signed token, expiry, limits, and manifest validation.
- Create `src/lib/menu/photo-crypto.ts`: browser AES-GCM key generation, encrypt, and decrypt.
- Create `src/lib/menu/local-menu-photos.ts`: IndexedDB persistence for received review photos.
- Create `src/lib/menu/photo-transfer-store.ts`: narrow Netlify Blobs adapter.
- Create `src/app/api/menu-photo-transfer/route.ts`: authenticated create, status, download, and receipt actions.
- Create `src/app/api/menu-photo-transfer/upload/route.ts`: public token-authorized ciphertext upload and completion.
- Create `src/app/menu-capture/page.tsx` and `src/app/menu-capture/menu-capture.module.css`: phone-first capture page.
- Modify `src/components/menus/MenuWorkspace.tsx` and its CSS: create QR, poll, decrypt, persist, preview, and feed files into the existing OCR flow.
- Add focused unit, API, UI contract, and Playwright tests for the new behavior.

### Task 1: Browser-memory navigation prefetch

**Files:**
- Create: `src/lib/client/workspace-prefetch.ts`
- Create: `__tests__/ui/workspace-prefetch.test.ts`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/overview/OverviewWorkspace.tsx`
- Modify: `src/components/procurement/ProcurementWorkspace.tsx`
- Modify: `src/components/menus/MenuWorkspace.tsx`
- Modify: `src/components/suppliers/SupplierWorkspace.tsx`
- Modify: `src/components/reporting/InsightsWorkspace.tsx`
- Modify: `src/components/reporting/HistoryWorkspace.tsx`
- Modify: `src/components/settings/SettingsWorkspace.tsx`

- [ ] **Step 1: Write failing cache tests**

```ts
import {
  clearWorkspacePrefetch,
  prefetchWorkspaceResponse,
  workspaceFetch,
} from '@/lib/client/workspace-prefetch';

test('reuses one successful prefetched response once', async () => {
  const fetcher = jest.fn(async () => new Response(JSON.stringify({ menus: [] })));
  await prefetchWorkspaceResponse('/api/menus?limit=50', fetcher);
  expect(await (await workspaceFetch('/api/menus?limit=50', undefined, fetcher)).json()).toEqual({ menus: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('clearing a warmed response forces a fresh request', async () => {
  const fetcher = jest.fn(async () => new Response('{}'));
  await prefetchWorkspaceResponse('/api/overview', fetcher);
  clearWorkspacePrefetch('/api/overview');
  await workspaceFetch('/api/overview', undefined, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- --runTestsByPath __tests__/ui/workspace-prefetch.test.ts`

Expected: FAIL because `workspace-prefetch` does not exist.

- [ ] **Step 3: Add the minimal cache**

```ts
const TTL_MS = 30_000;
const entries = new Map<string, { expiresAt: number; response: Response }>();
const pending = new Map<string, Promise<void>>();

export async function prefetchWorkspaceResponse(url: string, fetcher = fetch) {
  if (entries.get(url)?.expiresAt && entries.get(url)!.expiresAt > Date.now()) return;
  if (pending.has(url)) return pending.get(url);
  const request = fetcher(url, { cache: 'no-store' }).then(async (response) => {
    if (response.ok) entries.set(url, { expiresAt: Date.now() + TTL_MS, response: response.clone() });
  }).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

export async function workspaceFetch(url: string, init?: RequestInit, fetcher = fetch) {
  if (!init?.method || init.method === 'GET') {
    const entry = entries.get(url);
    if (entry && entry.expiresAt > Date.now()) {
      entries.delete(url);
      return entry.response.clone();
    }
  }
  return fetcher(url, { ...init, cache: 'no-store' });
}

export function clearWorkspacePrefetch(url?: string) {
  if (url) entries.delete(url); else entries.clear();
}
```

- [ ] **Step 4: Wire exact sidebar targets and consumers**

```ts
const DATA_BY_ROUTE = {
  '/dashboard': '/api/overview',
  '/procurement': '/api/requests?limit=50',
  '/menus': '/api/menus?limit=50',
  '/suppliers': '/api/suppliers?active=true&limit=50',
  '/insights': '/api/insights',
  '/history': '/api/history?limit=25',
  '/settings': '/api/settings',
} as const;
```

Call `prefetchWorkspaceResponse(DATA_BY_ROUTE[item.href])` from each link's pointer-enter and focus handlers. After account readiness, schedule the same bounded targets with `requestIdleCallback` or a short timeout while the document is visible. Replace only each workspace's first matching GET with `workspaceFetch`; retain direct fetches for pagination and detail routes. Call `clearWorkspacePrefetch()` after successful writes.

- [ ] **Step 5: Run focused and UI tests**

Run: `npm test -- --runTestsByPath __tests__/ui/workspace-prefetch.test.ts __tests__/ui/mobile-navigation-contract.test.ts __tests__/ui/overview-workspace.test.tsx __tests__/ui/procurement-workspace.test.tsx __tests__/ui/menu-workspace.test.tsx __tests__/ui/supplier-workspace.test.tsx __tests__/ui/reporting-workspaces.test.tsx __tests__/ui/settings-workspace.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/client/workspace-prefetch.ts src/app/'(app)'/layout.tsx src/components __tests__/ui
git commit -m "perf: prefetch workspace data before navigation"
```

### Task 2: Signed transfer domain and temporary storage

**Files:**
- Create: `src/lib/menu/photo-transfer.ts`
- Create: `src/lib/menu/photo-transfer-store.ts`
- Create: `src/lib/menu/photo-crypto.ts`
- Create: `__tests__/menu/photo-transfer.test.ts`
- Create: `__tests__/menu/photo-crypto.test.ts`
- Modify: `src/lib/menu/photo-intake.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing transfer tests**

```ts
test('accepts a valid token and rejects expiry or tampering', async () => {
  const token = await issuePhotoTransferToken({ accountId: 'acct', now: 1_000, secret: 'x'.repeat(32) });
  expect(await verifyPhotoTransferToken(token, { now: 1_001, secret: 'x'.repeat(32) })).toMatchObject({ accountId: 'acct' });
  await expect(verifyPhotoTransferToken(`${token}x`, { now: 1_001, secret: 'x'.repeat(32) })).rejects.toThrow('invalid');
  await expect(verifyPhotoTransferToken(token, { now: 1_000 + PHOTO_TRANSFER_TTL_MS + 1, secret: 'x'.repeat(32) })).rejects.toThrow('expired');
});

test('allows no more than ten bounded images', () => {
  expect(() => validateTransferFiles(Array.from({ length: 11 }, () => ({ size: 1, type: 'image/jpeg' })))).toThrow('10');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runTestsByPath __tests__/menu/photo-transfer.test.ts __tests__/menu/photo-crypto.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the pure contract**

```ts
export const PHOTO_TRANSFER_TTL_MS = 15 * 60_000;
export const MAX_TRANSFER_PHOTOS = 10;
export const MAX_TRANSFER_PHOTO_BYTES = 8 * 1_024 * 1_024;
export const MAX_TRANSFER_BATCH_BYTES = 40 * 1_024 * 1_024;

export type PhotoTransferManifest = {
  sessionId: string;
  accountId: string;
  expiresAt: number;
  completedAt?: number;
  files: Array<{ index: number; name: string; type: string; size: number; iv: string }>;
};
```

Sign the base64url JSON payload with HMAC-SHA256 using `NEXTAUTH_SECRET`, compare signatures with `timingSafeEqual`, and derive Blob keys from a SHA-256 digest of the random session ID. Keep encryption keys out of manifests and request logs.

- [ ] **Step 4: Add browser encryption and Blob adapter**

```ts
export async function encryptPhoto(file: File, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await file.arrayBuffer());
  return { ciphertext, iv: toBase64Url(iv) };
}

export async function decryptPhoto(ciphertext: ArrayBuffer, key: CryptoKey, iv: string) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, ciphertext);
}
```

Use `getStore('menu-photo-transfers')` from `@netlify/blobs` behind an interface with `getManifest`, `setManifest`, `putFile`, `getFile`, `deleteFile`, and `deleteManifest`. Install only the official package and retain the free-plan hard limit; do not configure a payment method or auto recharge.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --runTestsByPath __tests__/menu/photo-transfer.test.ts __tests__/menu/photo-crypto.test.ts __tests__/menu/photo-intake.test.ts`

Expected: PASS.

```bash
git add package.json package-lock.json src/lib/menu __tests__/menu
git commit -m "feat: add private phone photo transfer core"
```

### Task 3: Transfer API routes

**Files:**
- Create: `src/app/api/menu-photo-transfer/route.ts`
- Create: `src/app/api/menu-photo-transfer/upload/route.ts`
- Create: `__tests__/api/menu-photo-transfer.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover: unauthenticated session creation is `401`; invalid or expired token is `400`; an upload with eleven files, a non-image type, or an oversized body is rejected; a signed-in matching account can poll and download; receipt deletes all temporary data.

```ts
expect((await POST(createRequest({ action: 'create' }))).status).toBe(401);
expect((await uploadPOST(uploadRequest({ token: validToken, index: 10 }))).status).toBe(400);
expect((await POST(accountRequest({ action: 'receipt', token: validToken }))).status).toBe(200);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runTestsByPath __tests__/api/menu-photo-transfer.test.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement bounded actions**

`POST /api/menu-photo-transfer` accepts `create`, `status`, `download`, and `receipt`. `create`, `status`, `download`, and `receipt` require the existing authenticated account context and verify the token account. `POST /api/menu-photo-transfer/upload` accepts `file` and `complete`; it verifies the signed token, same-site browser mutation headers, image metadata, indices `0..9`, per-file and batch byte limits, and one-time completion. All responses are private/no-store.

- [ ] **Step 4: Run routes, security tests, and commit**

Run: `npm test -- --runTestsByPath __tests__/api/menu-photo-transfer.test.ts __tests__/security/private-mutation-routes.test.ts`

Expected: PASS.

```bash
git add src/app/api/menu-photo-transfer __tests__/api/menu-photo-transfer.test.ts __tests__/security/private-mutation-routes.test.ts
git commit -m "feat: add bounded menu photo transfer routes"
```

### Task 4: Phone capture and laptop receipt UI

**Files:**
- Create: `src/app/menu-capture/page.tsx`
- Create: `src/app/menu-capture/menu-capture.module.css`
- Create: `src/lib/menu/local-menu-photos.ts`
- Modify: `src/components/menus/MenuWorkspace.tsx`
- Modify: `src/components/menus/menu-workspace.module.css`
- Modify: `__tests__/ui/menu-workspace.test.tsx`
- Modify: `tests/e2e/product-workspace.spec.ts`

- [ ] **Step 1: Add failing UI contract tests**

Assert the phone page has a camera file input with `accept="image/*"`, `capture="environment"`, and `multiple`; the copy says “Up to 10 photos”; previews are removable; Done is disabled until photos exist; the laptop QR copy promises automatic receipt and does not ask the user to refresh.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --runTestsByPath __tests__/ui/menu-workspace.test.tsx`

Expected: FAIL because the new capture flow is absent.

- [ ] **Step 3: Implement the phone page**

Read the signed token and AES key from `window.location.hash`, immediately remove the hash from the visible address, show a single large “Take menu photos” action, permit camera or gallery selection, validate and preview up to ten photos, upload encrypted photos sequentially with visible progress, then send `complete`. The final state says the photos were sent and the user may close the page.

- [ ] **Step 4: Implement laptop receipt and local persistence**

Create a transfer session only when “Use your phone” opens. Put the token and key only in the QR fragment. Poll every two seconds only while the QR panel is open and the tab is visible. On completion, download each ciphertext file, decrypt to a `File`, add it to the existing `photos` state, persist a Blob review copy in IndexedDB, send `receipt`, and stop polling. Show received thumbnails and “Scan again” for another batch.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --runTestsByPath __tests__/ui/menu-workspace.test.tsx __tests__/menu/photo-intake.test.ts __tests__/api/menu-photo-transfer.test.ts`

Expected: PASS.

```bash
git add src/app/menu-capture src/lib/menu/local-menu-photos.ts src/components/menus __tests__/ui/menu-workspace.test.tsx tests/e2e/product-workspace.spec.ts
git commit -m "feat: receive phone menu photos on the laptop"
```

### Task 5: End-to-end verification and cleanup

**Files:**
- Modify only files required by failures.

- [ ] **Step 1: Run all non-browser checks**

Run: `npm test && npm run test:integration && npm run typecheck && npm run lint && npm run build`

Expected: every command exits `0`.

- [ ] **Step 2: Run Chrome-sized product QA**

Verify public navigation, every signed-in sidebar item, a warm revisit, mobile sidebar, QR generation, phone capture at `390x844`, ten-photo enforcement, Done, automatic laptop receipt, OCR handoff, and a fresh second QR. Confirm browser console has no new error.

- [ ] **Step 3: Measure the result**

Record cold and warm navigation timing. Warm sidebar routes must present usable content in under one second on the production build; a free-tier cold wake may take longer only before prefetch has completed.

- [ ] **Step 4: Remove implementation debris and commit**

Delete no user-owned files. Remove debug logging, stale branches only after merge, and any redundant helper or test introduced by this feature. Do not add a database migration, table, column, paid API, billing provider, card detail, or scheduled paid service.

```bash
git add -A
git commit -m "test: verify fast navigation and phone photo intake"
```
