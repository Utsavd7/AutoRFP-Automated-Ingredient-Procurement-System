# Public Story Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the home buying journey and guided product tour the same measured desktop viewport rhythm and subordinate typography as their approved opening frames.

**Architecture:** Keep both public routes server rendered and unchanged structurally. Add height-qualified desktop rules to the existing public stylesheets, then extend the real-browser responsive contract to measure section height, clipping, typography hierarchy, and short-window fallback.

**Tech Stack:** Next.js App Router, React server components, route-scoped CSS, shared public CSS, Playwright, Jest

---

### Task 1: Frame the home-page story

**Files:**
- Modify: `tests/e2e/public-site.spec.ts`
- Modify: `src/app/landing.css`

- [ ] **Step 1: Add the failing home-story browser contract**

Add a shared desktop matrix near `firstFoldSizes` in `tests/e2e/public-site.spec.ts`:

```ts
const storyFrameSizes = [
  { name: 'large desktop', width: 1440, height: 960 },
  { name: 'standard desktop', width: 1366, height: 768 },
  { name: 'compact desktop', width: 1024, height: 900 },
] as const;
```

Add this desktop-only test inside `public landing responsive contract`:

```ts
test('gives every home story scene one measured desktop frame', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

  for (const size of storyFrameSizes) {
    await test.step(size.name, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/');

      const frames = page.locator([
        '.landing-story__intro',
        '.story-scene',
        '.privacy-story__grid',
      ].join(', '));
      await expect(frames).toHaveCount(7);

      const measurements = await frames.evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          name: element.className,
          height: box.height,
          verticalOverflow: element.scrollHeight - element.clientHeight,
          horizontalOverflow: element.scrollWidth - element.clientWidth,
        };
      }));
      for (const measurement of measurements) {
        expect(measurement.height, `${measurement.name} height`).toBeGreaterThanOrEqual(
          size.height - 2,
        );
        expect(measurement.verticalOverflow, `${measurement.name} vertical clipping`).toBeLessThanOrEqual(1);
        expect(measurement.horizontalOverflow, `${measurement.name} horizontal clipping`).toBeLessThanOrEqual(1);
      }

      const heroSize = await page.locator('.public-hero h1').evaluate((element) => (
        Number.parseFloat(getComputedStyle(element).fontSize)
      ));
      const introSize = await page.locator('.landing-story__intro h2').evaluate((element) => (
        Number.parseFloat(getComputedStyle(element).fontSize)
      ));
      const privacySize = await page.locator('.privacy-story h2').evaluate((element) => (
        Number.parseFloat(getComputedStyle(element).fontSize)
      ));
      const stepSizes = await page.locator('.story-scene__copy h3').evaluateAll((headings) => (
        headings.map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize))
      ));

      expect(introSize).toBeLessThanOrEqual(heroSize * 1.05);
      expect(privacySize).toBeLessThanOrEqual(heroSize * 0.9);
      for (const stepSize of stepSizes) expect(stepSize).toBeLessThanOrEqual(heroSize * 0.85);
      await expectNoPageOverflow(page);
    });
  }
});
```

Add the short-window fallback test:

```ts
test('keeps home story scenes naturally sized on short desktops', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

  await page.setViewportSize({ width: 1024, height: 650 });
  await page.goto('/');
  const frames = page.locator('.landing-story__intro, .story-scene, .privacy-story__grid');
  const minHeights = await frames.evaluateAll((elements) => (
    elements.map((element) => getComputedStyle(element).minHeight)
  ));
  expect(minHeights).not.toContain('650px');
  await expectNoPageOverflow(page);
});
```

- [ ] **Step 2: Run the home contract and verify RED**

Run:

```bash
npx playwright test tests/e2e/public-site.spec.ts --project=desktop-chromium --grep "home story scene"
```

Expected: the full-frame test fails because the introduction, story scenes, and privacy section are shorter than the desktop viewport; typography hierarchy also fails at the standard desktop height.

- [ ] **Step 3: Add the minimal home-page scale rules**

In `src/app/landing.css`, change the story track width from `82rem` to the established public `76rem` measure:

```css
.landing-story__track {
  width: min(100% - 2rem, 76rem);
}
```

Extend the existing `@media (min-width: 901px) and (min-height: 720px)` block with height-aware story sizing:

```css
.landing-story__intro {
  min-height: 100svh;
  align-content: center;
  gap: clamp(2rem, min(7vw, 5vh), 4rem);
  padding-block: clamp(4rem, 8vh, 7rem);
}

.landing-story__intro h2 {
  font-size: clamp(2.75rem, min(4.5vw, 7vh), 4.5rem);
}

.story-scene {
  min-height: 100svh;
  padding-block: clamp(3.5rem, 7vh, 6rem);
}

.story-scene__copy h3 {
  font-size: clamp(2.35rem, min(3.2vw, 5.8vh), 3.4rem);
}

.privacy-story__grid {
  min-height: 100svh;
  padding-block: clamp(4rem, 8vh, 7rem);
}

.privacy-story h2 {
  font-size: clamp(2.6rem, min(3.8vw, 6vh), 4rem);
}
```

Do not change any media rule at or below 900 pixels wide, and do not alter the existing diagrams, motion rules, copy, components, calls to action, or footer.

- [ ] **Step 4: Run the home contract and verify GREEN**

Run:

```bash
npx playwright test tests/e2e/public-site.spec.ts --project=desktop-chromium --grep "home story scene"
```

Expected: both home-story tests pass at the three full desktop sizes and the 1024 by 650 fallback size.

- [ ] **Step 5: Commit the home-page frame**

```bash
git add tests/e2e/public-site.spec.ts src/app/landing.css
git commit -m "feat: align home story scale"
```

### Task 2: Frame the guided product story

**Files:**
- Modify: `tests/e2e/public-site.spec.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add the failing product-story browser contract**

Add this desktop-only test inside `public product tour responsive contract`:

```ts
test('gives every guided product scene one measured desktop frame', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

  for (const size of storyFrameSizes) {
    await test.step(size.name, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/product');

      const frames = page.locator('.tour-step, .product-principles');
      await expect(frames).toHaveCount(4);
      const measurements = await frames.evaluateAll((elements) => elements.map((element) => ({
        name: element.className,
        height: element.getBoundingClientRect().height,
        verticalOverflow: element.scrollHeight - element.clientHeight,
        horizontalOverflow: element.scrollWidth - element.clientWidth,
      })));
      for (const measurement of measurements) {
        expect(measurement.height, `${measurement.name} height`).toBeGreaterThanOrEqual(
          size.height - 2,
        );
        expect(measurement.verticalOverflow, `${measurement.name} vertical clipping`).toBeLessThanOrEqual(1);
        expect(measurement.horizontalOverflow, `${measurement.name} horizontal clipping`).toBeLessThanOrEqual(1);
      }

      const heroSize = await page.locator('.product-hero h1').evaluate((element) => (
        Number.parseFloat(getComputedStyle(element).fontSize)
      ));
      const stepSizes = await page.locator('.tour-step__copy h2').evaluateAll((headings) => (
        headings.map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize))
      ));
      const principlesSize = await page.locator('.product-principles h2').evaluate((element) => (
        Number.parseFloat(getComputedStyle(element).fontSize)
      ));
      for (const stepSize of stepSizes) expect(stepSize).toBeLessThanOrEqual(heroSize * 0.65);
      expect(principlesSize).toBeLessThanOrEqual(heroSize * 0.72);
      await expectNoPageOverflow(page);
    });
  }
});
```

Add the matching fallback test:

```ts
test('keeps guided product scenes naturally sized on short desktops', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

  await page.setViewportSize({ width: 1024, height: 650 });
  await page.goto('/product');
  const frames = page.locator('.tour-step, .product-principles');
  const minHeights = await frames.evaluateAll((elements) => (
    elements.map((element) => getComputedStyle(element).minHeight)
  ));
  expect(minHeights).not.toContain('650px');
  await expectNoPageOverflow(page);
});
```

- [ ] **Step 2: Run the product contract and verify RED**

Run:

```bash
npx playwright test tests/e2e/public-site.spec.ts --project=desktop-chromium --grep "guided product scene"
```

Expected: the full-frame test fails because the tour steps and principles section use fixed natural heights rather than the desktop viewport.

- [ ] **Step 3: Add the minimal guided-product scale rules**

In `src/app/globals.css`, add a height-qualified desktop block immediately before the existing `@media (max-width: 900px)` rules:

```css
@media (min-width: 901px) and (min-height: 720px) {
  .tour-step {
    min-height: 100svh;
    padding-block: clamp(3.5rem, 7vh, 6rem);
  }

  .tour-step__copy h2 {
    font-size: clamp(2.35rem, min(3.7vw, 6.2vh), 3.6rem);
  }

  .product-principles {
    min-height: 100svh;
    align-items: center;
    padding-block: clamp(4rem, 8vh, 7rem);
  }

  .product-principles h2 {
    font-size: clamp(2.6rem, min(4.2vw, 7vh), 4rem);
  }
}
```

Do not alter the product hero, internal mockup typography, sample data, component markup, closing call to action, or existing tablet and phone rules.

- [ ] **Step 4: Run the product contract and verify GREEN**

Run:

```bash
npx playwright test tests/e2e/public-site.spec.ts --project=desktop-chromium --grep "guided product scene"
```

Expected: both product-story tests pass at the three full desktop sizes and the 1024 by 650 fallback size.

- [ ] **Step 5: Commit the guided-product frame**

```bash
git add tests/e2e/public-site.spec.ts src/app/globals.css
git commit -m "feat: align product story scale"
```

### Task 3: Verify scope and release

**Files:**
- Verify: `src/app/landing.css`
- Verify: `src/app/globals.css`
- Verify: `tests/e2e/public-site.spec.ts`

- [ ] **Step 1: Run complete verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:integration
npx playwright test tests/e2e/public-site.spec.ts
git diff --check main...HEAD
```

Expected: all unit, integration, browser, type, lint, build, and whitespace checks exit zero.

- [ ] **Step 2: Confirm the change stayed public and presentation-only**

```bash
git diff --name-only main...HEAD -- package.json package-lock.json prisma src/app/api src/lib src/components/dashboard src/components/public
```

Expected: no output. No package, billing, database, authentication, API, dashboard, public component, copy, or product-workflow files changed.

- [ ] **Step 3: Review the exact release diff**

Confirm the final branch contains only:

```text
docs/superpowers/specs/2026-09-03-cinematic-landing-story-design.md
docs/superpowers/plans/2026-09-03-public-story-scale.md
src/app/landing.css
src/app/globals.css
tests/e2e/public-site.spec.ts
```

Confirm the 901 pixel by 720 pixel boundary uses viewport frames, 1024 by 650 uses natural height, and widths at 900, 768, 555, 390, and 320 pixels preserve the existing stacked layout.

- [ ] **Step 4: Merge and push after review**

Fast-forward the reviewed branch into `main`, rerun `npm test` on merged `main`, push `main`, verify local and remote hashes match, and remove only the temporary feature worktree and merged feature branch.
