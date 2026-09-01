# Fast navigation and phone photo transfer

## Goal

Make every public and signed in navigation feel immediate, and let a restaurant move menu photos from a phone to the open laptop workspace by scanning a QR code.

## Performance design

- Keep the existing Next.js routes and components.
- Prefetch visible routes and their first bounded private data request before a likely click.
- Hold prefetched private data only in browser memory for a short period. Never write it to shared HTTP caches or browser storage.
- Consume prefetched data once, clear it after a write, and fall back to the existing request path on errors.
- Warm the free database only while a signed in tab is visible and recently active. Stop when the tab is hidden or inactive so the free allowance is not wasted.
- Preserve immediate skeletons for unavoidable first cold starts.
- Target a warm sidebar click to usable content within one second. Treat free tier cold wake time as background work whenever possible.

## Phone photo design

- The laptop creates a random, signed transfer session that expires after 15 minutes. The secret is placed in the QR URL fragment so it is not sent in ordinary URL logs.
- A public phone capture page accepts up to 10 menu photos per scan and shows previews, removal, progress, and a clear Done action.
- Photos are resized only when needed to meet strict per photo and per batch limits while preserving a readable review copy.
- Temporary client encrypted transfer files use the existing Netlify free project storage. No additional paid service, card, database table, or database column is introduced.
- The laptop polls only while the transfer dialog is open, downloads the completed batch, stores the photos in IndexedDB on that laptop, and confirms receipt.
- The server deletes temporary copies after receipt. Expired sessions are rejected and removed during the next transfer cleanup.
- The laptop shows the received photos in the menu workspace, runs the existing browser OCR, and keeps the local photos associated with the resulting menu.
- A user can scan a fresh QR code for another batch of up to 10 photos.

## Security and failure handling

- Transfer tokens use the existing secret, strong randomness, a digest based storage key, a short expiry, and one time completion.
- Upload endpoints check origin, content type, image count, individual size, total size, and session state.
- Photos are private and never exposed through a guessable public URL.
- An expired, already completed, oversized, or malformed transfer receives a plain recovery message and a new QR action.
- If temporary storage is unavailable, ordinary laptop photo upload remains usable.

## Testing

- Unit tests cover token validation, limits, expiry, completion, cache consumption, cache invalidation, and activity based warming.
- Route tests cover unauthorized creation, invalid upload, successful upload, laptop receipt, and cleanup.
- UI tests cover 10 photo maximum, remove and rescan behavior, Done state, automatic laptop receipt, local persistence, and clear error copy.
- Production QA measures public navigation, every sidebar item, a warm revisit, a cold recovery, and the phone sized capture page in Chrome.

## Scope boundary

Photos persist only on the laptop browser that received them. Menu and ingredient records continue to sync normally across authorized devices. Cross device permanent image storage is intentionally excluded to keep the product private, small, and free for the pilot.
