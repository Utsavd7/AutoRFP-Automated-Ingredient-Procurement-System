# First Fold and Landing Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete desktop hero fit in the opening viewport and add restrained, scroll-linked motion to every operational landing diagram.

**Architecture:** Keep the home route server rendered and dependency free. Add height-aware desktop overrides and progressive CSS view-timeline animation only in the existing route-scoped `landing.css`; extend the current Playwright contract so the viewport fold, fallback behaviour, and reduced-motion result are measured in a real browser.

**Tech Stack:** Next.js App Router, React server components, CSS media queries and view timelines, Playwright, Jest

---

### Task 1: Define the browser contract

**Files:**
- Modify: `tests/e2e/public-site.spec.ts`
- Modify: `__tests__/ui/public-copy.test.tsx`

- [ ] **Step 1: Add the first-fold failing browser test**

Add this desktop matrix and test to `tests/e2e/public-site.spec.ts`:

```ts
const firstFoldSizes = [
  { name: 'wide laptop', width: 1440, height: 960 },
  { name: 'standard laptop', width: 1366, height: 768 },
  { name: 'compact laptop', width: 1024, height: 900 },
] as const;

test('fits the complete desktop hero before the first section line', async ({ page }) => {
  for (const size of firstFoldSizes) {
    await test.step(size.name, async () => {
      await page.setViewportSize(size);
      await page.goto('/');

      const hero = page.locator('.public-hero');
      const foldLine = page.locator('.proof-band');
      await expect(hero.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(hero.getByRole('group', { name: 'QuotePlate buying journey' })).toBeVisible();
      await expect(hero.getByText('No supplier commission. No card required.')).toBeVisible();

      const foldTop = await foldLine.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(foldTop - size.height)).toBeLessThanOrEqual(2);
    });
  }
});
```

- [ ] **Step 2: Add the motion and fallback contract**

Extend the public copy test to require route-scoped view timelines and no infinite motion:

```ts
const landingCss = source('src/app/landing.css');
expect(landingCss).toContain('@supports (animation-timeline: view())');
expect(landingCss).toContain('animation-timeline: view()');
expect(landingCss).not.toMatch(/animation[^;]*infinite/);
```

Extend the existing reduced-motion Playwright step to assert that `.supplier-diagram`, `.request-route`, `.decision-preview`, and `.privacy-map` have no running animation and no transform when reduced motion is active.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/public-copy.test.tsx
npx playwright test tests/e2e/public-site.spec.ts --grep "fits the complete desktop hero"
```

Expected: Jest fails because view-timeline CSS is absent; Playwright fails because the sample facts border does not sit at the viewport fold at all three desktop sizes.

- [ ] **Step 4: Commit the failing contract**

```bash
git add __tests__/ui/public-copy.test.tsx tests/e2e/public-site.spec.ts
git commit -m "test: define first-fold landing motion"
```

### Task 2: Implement the route-scoped CSS

**Files:**
- Modify: `src/app/landing.css`

- [ ] **Step 1: Add the desktop first-frame override**

Add a desktop and height-qualified rule that subtracts the 4.75rem header and its one-pixel border from `100svh`, reduces only vertical hero spacing, and caps the display type by both viewport width and height:

```css
@media (min-width: 901px) and (min-height: 720px) {
  .public-hero {
    min-height: calc(100svh - 4.75rem - 1px);
    padding-block: clamp(2rem, 4vh, 3.5rem);
  }

  .public-hero h1 {
    font-size: clamp(3.4rem, min(5.8vw, 7.2vh), 5.4rem);
  }

  .public-hero__lede,
  .public-hero__actions,
  .public-hero__note {
    margin-top: clamp(1rem, 2.2vh, 1.75rem);
  }
}
```

Do not apply this rule below 901 pixels wide or 720 pixels tall; those screens retain natural content height.

- [ ] **Step 2: Add restrained diagram motion**

Add one small compositor-safe reveal and one line reveal. Apply them inside `@supports (animation-timeline: view())` to the intake, supplier, request, comparison, decision, and privacy visuals with a short `entry` range. Keep starting opacity high enough that content remains readable throughout:

```css
@keyframes landing-diagram-enter {
  from { opacity: 0.72; transform: translateY(1rem); }
  to { opacity: 1; transform: translateY(0); }
}

@supports (animation-timeline: view()) {
  .intake-diagram,
  .supplier-diagram,
  .request-route,
  .story-scene--comparison .decision-preview,
  .decision-route,
  .privacy-map {
    animation: landing-diagram-enter linear both;
    animation-timeline: view();
    animation-range: entry 5% cover 28%;
  }
}
```

Use short child ranges for the hero cards and supplier category chips so they appear in reading order. Do not use looping motion, layout-property animation, JavaScript, or a new package.

- [ ] **Step 3: Preserve reduced motion**

Inside the existing landing reduced-motion query, reset the animated landing selectors:

```css
.hero-route > div,
.intake-diagram,
.supplier-diagram,
.request-route,
.story-scene--comparison .decision-preview,
.decision-route,
.privacy-map {
  animation: none !important;
  opacity: 1 !important;
  transform: none !important;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/public-copy.test.tsx
npx playwright test tests/e2e/public-site.spec.ts --grep "desktop hero|reduced motion"
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/app/landing.css
git commit -m "feat: frame and animate the landing story"
```

### Task 3: Verify and release

**Files:**
- Verify only: `src/app/landing.css`, `tests/e2e/public-site.spec.ts`, `__tests__/ui/public-copy.test.tsx`

- [ ] **Step 1: Run complete verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/public-site.spec.ts
git diff --check main...HEAD
```

Expected: every command exits zero, the full public browser suite passes on desktop and mobile, and the diff has no whitespace errors.

- [ ] **Step 2: Confirm scope**

```bash
git diff --name-only main...HEAD -- package.json package-lock.json prisma src/app/api src/lib src/components/dashboard
```

Expected: no output. The landing CSS stays route scoped and no billing, database, authentication, API, package, or dashboard file changes.

- [ ] **Step 3: Merge and push after review**

Fast-forward the reviewed branch into `main`, rerun the unit suite on merged `main`, push `main`, and confirm local and remote commit hashes match.
