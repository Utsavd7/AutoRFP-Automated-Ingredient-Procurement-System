# Compact Workspace Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fit the complete workspace registration sheet within a 1440 by 900 laptop viewport and pin the home, product, and start headers on tablets and laptops.

**Architecture:** Keep the current server-rendered page structure and authentication flow. Add explicit route variants to the existing headers, rearrange the existing start-form fields with CSS grid classes, and use height-qualified CSS for the compact desktop treatment while retaining natural mobile flow.

**Tech Stack:** Next.js App Router, React, CSS Modules, shared CSS, Playwright, Jest

---

### Task 1: Pin only the approved page headers

**Files:**
- Modify: `tests/e2e/public-site.spec.ts`
- Modify: `tests/e2e/auth.spec.ts`
- Modify: `src/components/public/PublicHeader.tsx`
- Modify: `src/components/public/PublicLandingPage.tsx`
- Modify: `src/app/product/page.tsx`
- Modify: `src/components/auth/AuthPageShell.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/auth/AuthExperience.module.css`

- [ ] **Step 1: Add the failing public-header browser contract**

Inside `public landing responsive contract` in `tests/e2e/public-site.spec.ts`, add:

```ts
test('pins the public header on home and product above phone width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

  for (const route of ['/', '/product']) {
    await test.step(`${route} tablet`, async () => {
      await page.setViewportSize({ width: 900, height: 900 });
      await page.goto(route);
      await page.evaluate(() => window.scrollTo(0, 700));
      await expect.poll(() => page.getByRole('banner').evaluate((element) => (
        element.getBoundingClientRect().top
      ))).toBeGreaterThanOrEqual(-1);
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 700));
  expect(await page.getByRole('banner').evaluate((element) => (
    element.getBoundingClientRect().bottom
  ))).toBeLessThan(0);

  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/privacy');
  await page.evaluate(() => window.scrollTo(0, 700));
  expect(await page.getByRole('banner').evaluate((element) => (
    element.getBoundingClientRect().bottom
  ))).toBeLessThan(0);
});
```

- [ ] **Step 2: Add the failing start-header browser contract**

Before the serial account journey in `tests/e2e/auth.spec.ts`, add:

```ts
test.describe('workspace creation layout', () => {
  test('pins the start header above phone width only', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Responsive layout contract');

    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/start');
    await page.evaluate(() => window.scrollTo(0, 700));
    const header = page.locator('main > header');
    await expect.poll(() => header.evaluate((element) => (
      element.getBoundingClientRect().top
    ))).toBeGreaterThanOrEqual(-1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/start');
    await page.evaluate(() => window.scrollTo(0, 700));
    expect(await page.locator('main > header').evaluate((element) => (
      element.getBoundingClientRect().bottom
    ))).toBeLessThan(0);
  });
});
```

The auth header sits inside the page `<main>`, so target it structurally as `main > header` while keeping the semantic element unchanged.

- [ ] **Step 3: Run the sticky-header checks and verify RED**

Run:

```bash
npx playwright test tests/e2e/public-site.spec.ts tests/e2e/auth.spec.ts --project=desktop-chromium --grep "pins the"
```

Expected: the tablet cases fail because all headers currently scroll away.

- [ ] **Step 4: Add an explicit sticky variant to the public header**

Update `src/components/public/PublicHeader.tsx`:

```tsx
type PublicHeaderProps = {
  home?: boolean;
  sticky?: boolean;
};

export function PublicHeader({ home = false, sticky = false }: PublicHeaderProps) {
  return (
    <header className={`public-header${sticky ? ' public-header--sticky' : ''}`}>
```

In `src/components/public/PublicLandingPage.tsx`, use:

```tsx
<PublicHeader home sticky />
```

In `src/app/product/page.tsx`, use:

```tsx
<PublicHeader sticky />
```

Do not pass `sticky` from `LegalPageLayout`, so privacy and terms retain normal scrolling.

- [ ] **Step 5: Mark the auth page mode without adding state**

In `src/components/auth/AuthPageShell.tsx`, add the existing mode as a data attribute:

```tsx
<main className={styles.page} data-mode={props.mode} id="main-content">
```

- [ ] **Step 6: Add tablet-and-laptop sticky CSS**

In `src/app/globals.css`, immediately after the base `.public-header` rule, add:

```css
@media (min-width: 761px) {
  .public-header--sticky {
    position: sticky;
    top: 0;
    z-index: 30;
  }
}
```

In `src/components/auth/AuthExperience.module.css`, immediately before the `@media (max-width: 1020px)` block, add:

```css
@media (min-width: 761px) {
  .page[data-mode="start"] {
    overflow: clip;
  }

  .page[data-mode="start"] .header {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--stone);
  }
}
```

Do not add fixed positioning, backdrop filters, scroll listeners, shrinking behaviour, or animation.

- [ ] **Step 7: Run the sticky-header checks and verify GREEN**

Run:

```bash
npx playwright test tests/e2e/public-site.spec.ts tests/e2e/auth.spec.ts --project=desktop-chromium --grep "pins the"
```

Expected: both tests pass; home, product, and start stay at the top above 760 pixels, while phone home/start and tablet privacy scroll away.

- [ ] **Step 8: Commit the sticky headers**

```bash
git add tests/e2e/public-site.spec.ts tests/e2e/auth.spec.ts src/components/public/PublicHeader.tsx src/components/public/PublicLandingPage.tsx src/app/product/page.tsx src/components/auth/AuthPageShell.tsx src/app/globals.css src/components/auth/AuthExperience.module.css
git commit -m "feat: pin key public headers"
```

### Task 2: Compact the start form without removing fields

**Files:**
- Modify: `tests/e2e/auth.spec.ts`
- Modify: `src/components/auth/AuthForm.tsx`
- Modify: `src/components/auth/AuthExperience.module.css`

- [ ] **Step 1: Add the failing desktop form-fit contract**

Inside `workspace creation layout` in `tests/e2e/auth.spec.ts`, add:

```ts
test('fits the complete start form in one laptop viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Responsive layout contract');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/start');

  const sheet = page.locator('#account-form');
  const terms = sheet.getByText('By creating a workspace', { exact: false });
  const emailButton = sheet.getByRole('button', { name: 'Create workspace with email' });
  const googleButton = sheet.getByRole('button', { name: 'Continue with Google' });
  await expect(terms).toBeVisible();
  await expect(emailButton).toBeVisible();
  await expect(googleButton).toBeVisible();

  const sheetBox = await sheet.boundingBox();
  const termsBox = await terms.boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(termsBox).not.toBeNull();
  expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(900);
  expect(termsBox!.y + termsBox!.height).toBeLessThanOrEqual(900);

  const fieldHeights = await sheet.locator('input').evaluateAll((inputs) => (
    inputs.map((input) => input.getBoundingClientRect().height)
  ));
  for (const height of fieldHeights) expect(height).toBeGreaterThanOrEqual(44);

  const rowTop = async (label: string) => {
    const box = await page.getByLabel(label).boundingBox();
    expect(box).not.toBeNull();
    return box!.y;
  };
  expect(await rowTop('Restaurant name')).toBeCloseTo(await rowTop('Restaurant phone'), 0);
  expect(await rowTop('Street address')).toBeCloseTo(await rowTop('City'), 0);
  expect(await rowTop('City')).toBeCloseTo(await rowTop('State'), 0);
  expect(await rowTop('PIN code')).toBeCloseTo(await rowTop('GSTIN optional'), 0);
  expect(await rowTop('Your name')).toBeCloseTo(await rowTop('Work email'), 0);
  expect(await rowTop('Work email')).toBeCloseTo(await rowTop('Password'), 0);

  const emailBox = await emailButton.boundingBox();
  const googleBox = await googleButton.boundingBox();
  expect(emailBox).not.toBeNull();
  expect(googleBox).not.toBeNull();
  expect(emailBox!.y).toBeCloseTo(googleBox!.y, 0);
  await expectNoPageOverflow(page);
});
```

Because `expectNoPageOverflow` currently lives in the public-site test, add this local helper near the top of `auth.spec.ts`:

```ts
async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}
```

- [ ] **Step 2: Add the failing natural-layout contract**

Inside the same describe block, add:

```ts
test('keeps short laptops and phones naturally stacked', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Responsive layout contract');

  await page.setViewportSize({ width: 1024, height: 650 });
  await page.goto('/start');
  const shortEmail = await page.getByRole('button', { name: 'Create workspace with email' }).boundingBox();
  const shortGoogle = await page.getByRole('button', { name: 'Continue with Google' }).boundingBox();
  expect(shortEmail).not.toBeNull();
  expect(shortGoogle).not.toBeNull();
  expect(shortGoogle!.y).toBeGreaterThan(shortEmail!.y + 44);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/start');
  const restaurant = await page.getByLabel('Restaurant name').boundingBox();
  const phone = await page.getByLabel('Restaurant phone').boundingBox();
  const phoneEmail = await page.getByRole('button', { name: 'Create workspace with email' }).boundingBox();
  const phoneGoogle = await page.getByRole('button', { name: 'Continue with Google' }).boundingBox();
  expect(restaurant).not.toBeNull();
  expect(phone).not.toBeNull();
  expect(phoneEmail).not.toBeNull();
  expect(phoneGoogle).not.toBeNull();
  expect(phone!.y).toBeGreaterThan(restaurant!.y + 44);
  expect(phoneGoogle!.y).toBeGreaterThan(phoneEmail!.y + 44);
  await expectNoPageOverflow(page);
});
```

- [ ] **Step 3: Run the form-layout checks and verify RED**

Run:

```bash
npx playwright test tests/e2e/auth.spec.ts --project=desktop-chromium --grep "start form|naturally stacked"
```

Expected: the 1440 by 900 check fails because the sheet extends below the viewport and the actions stack; the phone field-order assertion also fails until the form order is updated.

- [ ] **Step 4: Put fields in visual and keyboard order**

In the restaurant fieldset of `src/components/auth/AuthForm.tsx`, use this order and class assignment without changing any input attributes:

```tsx
<label className={styles.fieldHalf}>
  <span>Restaurant name</span>
  <input name="restaurantName" autoComplete="organization" maxLength={200} required />
</label>
<label className={styles.fieldHalf}>
  <span>Restaurant phone</span>
  <input name="phone" autoComplete="tel" inputMode="tel" maxLength={32} required />
</label>
<label className={`${styles.fieldWide} ${styles.fieldHalf}`}>
  <span>Street address</span>
  <input name="addressLine" autoComplete="street-address" maxLength={500} required />
</label>
<label className={styles.fieldQuarter}>
  <span>City</span>
  <input name="city" autoComplete="address-level2" maxLength={120} required />
</label>
<label className={styles.fieldQuarter}>
  <span>State</span>
  <input name="state" autoComplete="address-level1" maxLength={120} required />
</label>
<label className={styles.fieldQuarter}>
  <span>PIN code</span>
  <input name="pin" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
</label>
<label className={styles.fieldThreeQuarter}>
  <span>GSTIN <em>optional</em></span>
  <input
    name="gstin"
    autoCapitalize="characters"
    aria-describedby="gstin-help"
    maxLength={15}
    pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][A-Za-z0-9]Z[A-Za-z0-9]"
  />
  <small id="gstin-help">You can add this later in workspace settings.</small>
</label>
```

Use these exact class assignments for the owner fields:

```tsx
<label className={styles.fieldThird}>
  <span>Your name</span>
  <input name="ownerName" autoComplete="name" maxLength={200} required />
</label>

<label className={mode === 'signin' ? styles.fieldWide : styles.fieldThird}>
  <span>Work email</span>
  <input name="email" type="email" autoComplete="email" maxLength={320} required />
</label>

<label className={`${styles.fieldWide} ${mode === 'start' ? styles.fieldThird : ''}`}>
  <span>Password</span>
  <input
    name="password"
    type="password"
    autoComplete={mode === 'start' ? 'new-password' : 'current-password'}
    aria-describedby={mode === 'start' ? 'password-help' : undefined}
    minLength={8}
    maxLength={1024}
    required
  />
  {mode === 'start' && <small id="password-help">Use at least 8 characters.</small>}
</label>
```

This preserves the sign-in form while placing all three owner fields on one row in the wide start layout.

Add an action modifier without changing action behaviour:

```tsx
<div
  className={`${styles.actions} ${
    mode === 'signin' || emailOwnerSignupAvailable ? styles.actionsSplit : ''
  }`}
>
```

- [ ] **Step 5: Add the compact height-qualified desktop layout**

In `src/components/auth/AuthExperience.module.css`, before `@media (max-width: 1020px)`, add:

```css
@media (min-width: 1180px) and (min-height: 820px) {
  .page[data-mode="start"] .header {
    min-height: 4.75rem;
  }

  .page[data-mode="start"] .layout {
    grid-template-columns: minmax(17rem, 0.55fr) minmax(42rem, 1.45fr);
    gap: clamp(2.5rem, 4vw, 4rem);
    padding-block: clamp(1.25rem, 2.5vh, 1.75rem) 2rem;
  }

  .page[data-mode="start"] .context {
    top: 5.75rem;
    padding-top: 0.5rem;
  }

  .page[data-mode="start"] .context h1 {
    max-width: 12ch;
    font-size: clamp(3.4rem, min(4.4vw, 6vh), 4.6rem);
    line-height: 0.92;
  }

  .page[data-mode="start"] .introduction {
    margin-top: 1.25rem;
  }

  .page[data-mode="start"] .assurances {
    margin-top: 1.75rem;
  }

  .page[data-mode="start"] .assurances div {
    padding-block: 0.65rem;
  }

  .page[data-mode="start"] .sheetHeader {
    padding: 0.75rem 1.5rem;
  }

  .page[data-mode="start"] .pilotNotice {
    display: grid;
    grid-template-columns: 10rem minmax(0, 1fr);
    align-items: center;
    gap: 1rem;
    margin: 0.85rem 1.5rem 0;
    padding: 0.7rem 0.85rem;
  }

  .page[data-mode="start"] .pilotNotice ul {
    margin-top: 0;
  }

  .page[data-mode="start"] .form {
    padding: 1rem 1.5rem 1.2rem;
  }

  .page[data-mode="start"] .formIntro {
    padding-bottom: 1rem;
  }

  .page[data-mode="start"] .fieldset {
    padding: 0.8rem 0 0.95rem;
  }

  .page[data-mode="start"] .fieldset legend {
    margin-bottom: 0.65rem;
  }

  .page[data-mode="start"] .fieldGrid {
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 0.65rem 0.75rem;
  }

  .page[data-mode="start"] .fieldHalf { grid-column: span 6; }
  .page[data-mode="start"] .fieldQuarter { grid-column: span 3; }
  .page[data-mode="start"] .fieldThreeQuarter { grid-column: span 9; }
  .page[data-mode="start"] .fieldThird { grid-column: span 4; }

  .page[data-mode="start"] .fieldGrid input {
    min-height: 2.75rem;
  }

  .page[data-mode="start"] .actionsSplit {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
  }

  .page[data-mode="start"] .actionsSplit .divider {
    display: block;
    margin: 0;
  }

  .page[data-mode="start"] .actionsSplit .divider::before,
  .page[data-mode="start"] .actionsSplit .divider::after {
    display: none;
  }

  .page[data-mode="start"] .providerNote {
    grid-column: 1 / -1;
  }

  .page[data-mode="start"] .switchMode {
    margin-top: 0.85rem;
  }

  .page[data-mode="start"] .terms {
    margin-top: 0.35rem;
  }
}
```

In the existing `@media (max-width: 760px)` block, add:

```css
.fieldGrid { grid-template-columns: 1fr; }
.fieldWide { grid-column: auto; }
```

Remove the duplicate phone-only declarations for those two selectors from `@media (max-width: 480px)`.

- [ ] **Step 6: Run the form-layout checks and verify GREEN**

Run:

```bash
npx playwright test tests/e2e/auth.spec.ts --project=desktop-chromium --grep "start form|naturally stacked"
```

Expected: both tests pass at 1440 by 900, 1024 by 650, and 390 by 844 with 44 pixel inputs and no overflow.

- [ ] **Step 7: Commit the compact form**

```bash
git add tests/e2e/auth.spec.ts src/components/auth/AuthForm.tsx src/components/auth/AuthExperience.module.css
git commit -m "feat: compact workspace registration"
```

### Task 3: Verify scope and release

**Files:**
- Verify: `src/components/public/PublicHeader.tsx`
- Verify: `src/components/public/PublicLandingPage.tsx`
- Verify: `src/app/product/page.tsx`
- Verify: `src/components/auth/AuthPageShell.tsx`
- Verify: `src/components/auth/AuthForm.tsx`
- Verify: `src/app/globals.css`
- Verify: `src/components/auth/AuthExperience.module.css`
- Verify: `tests/e2e/public-site.spec.ts`
- Verify: `tests/e2e/auth.spec.ts`

- [ ] **Step 1: Run complete verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:integration
npx playwright test tests/e2e/public-site.spec.ts tests/e2e/auth.spec.ts
git diff --check main...HEAD
```

Expected: unit, type, lint, production build, integration, public-browser, authentication-browser, and whitespace checks exit zero.

- [ ] **Step 2: Confirm the change has no commercial or data impact**

```bash
git diff --name-only main...HEAD -- package.json package-lock.json prisma src/app/api src/lib src/components/dashboard
```

Expected: no output. No dependency, billing, database, authentication backend, API, or dashboard file changed.

- [ ] **Step 3: Review the exact release diff**

Confirm the final branch contains only:

```text
docs/superpowers/specs/2026-09-03-compact-workspace-form-design.md
docs/superpowers/plans/2026-09-03-compact-workspace-form.md
src/app/globals.css
src/app/product/page.tsx
src/components/auth/AuthExperience.module.css
src/components/auth/AuthForm.tsx
src/components/auth/AuthPageShell.tsx
src/components/public/PublicHeader.tsx
src/components/public/PublicLandingPage.tsx
tests/e2e/auth.spec.ts
tests/e2e/public-site.spec.ts
```

Confirm the complete start form fits at 1440 by 900, shorter screens retain natural height, phone fields and actions stack, home/product/start headers pin only above 760 pixels, legal and sign-in headers remain unchanged, and no horizontal overflow appears.

- [ ] **Step 4: Merge and push after review**

Fast-forward the reviewed branch into `main`, rerun `npm test` on merged `main`, push `main`, verify local and remote hashes match, and remove only the temporary feature worktree and merged feature branch.
