# Workspace navigation performance design

## Goal

Make repeat navigation between every QuotePlate sidebar page feel immediate without adding infrastructure, paid services, database storage, or complex state management.

## Evidence and root cause

Live Chrome measurements on 1 September 2026 showed:

- a previously warm Menus navigation at about 0.5 seconds;
- Suppliers at about 3.1 seconds;
- Insights at about 3.1 seconds;
- an immediate return to Suppliers still at about 3.1 seconds.

The pages displayed no browser errors. The existing workspace prefetch helper removes a successful response from its memory cache the first time a page consumes it. A normal page fetch is not cached at all. Consequently, returning to a sidebar page starts another authenticated server and database request and shows the loading skeleton again.

## Cost boundary

The fix changes only existing browser-side TypeScript. It adds no package, API, hosted cache, worker, database table, database column, subscription, or paid feature. Cost remains ₹0.

## Design

The existing workspace response cache will retain the latest successful response for each known first-page request within the active workspace scope.

The flow will be:

1. A successful prefetch or normal workspace fetch stores a reusable response.
2. Navigation during the 30-second freshness window receives a clone immediately.
3. After the freshness window, navigation receives the last successful response immediately while one background request refreshes that entry.
4. A later navigation receives the refreshed response.
5. A successful mutation, workspace change, or sign-out clears every cached response.

Only the seven existing first-page requests participate. Search, pagination, detail pages, and mutation responses remain uncached. Concurrent reads for the same page share one refresh request.

This is stale-while-refresh behaviour in the existing helper, not a new state-management layer. Components and API contracts remain unchanged.

## Failure handling

If no successful response exists, the page uses the normal request and loading state. If a background refresh fails, the last successful response remains available for the current session and the next expired read may try again. Unauthorized and other unsuccessful responses are never cached.

## Verification

Tests will be written before implementation and cover:

- a normal workspace fetch populating the cache;
- repeated reads reusing a fresh response;
- an expired response returning immediately and refreshing once;
- concurrent expired reads sharing the same refresh;
- a failed refresh not replacing successful data;
- mutation, workspace change, and sign-out invalidation;
- tenant scope isolation;
- unknown URLs and non-GET requests bypassing the cache.

After focused tests pass, the full unit suite, type check, lint, production build, and live Chrome navigation check must pass.
