# QuotePlate Product-Led Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved A1 product-led QuotePlate visual direction across the public website and shared product surfaces without changing business logic, data shape, or operating cost.

**Architecture:** Keep the existing Next.js App Router structure and server-rendered public pages. Add one focused, static product-preview component backed by the existing coherent sample procurement data, then revise existing JSX and CSS rather than adding a UI framework or animation dependency. Product-shell work is limited to shared structure and visual tokens so all existing workflows and tests remain intact.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules/global CSS, Jest, Playwright, locally hosted Manrope and Newsreader fonts.

---

## File map

- Create `src/components/public/ProductDecisionPreview.tsx`: static, accessible hero product preview backed by `src/data/sample-procurement.ts`.
- Modify `src/components/public/PublicLandingPage.tsx`: approved hero message, decision preview, factual operating band, retention story, existing security and pilot actions.
- Modify `src/app/globals.css`: public hero, nested product frame, responsive layouts, restrained motion, product-tour consistency.
- Modify `src/components/public/ProductTour.tsx`: only copy/structure needed to align the tour with the approved product-led hierarchy.
- Modify `src/components/auth/AuthPageShell.tsx`: explain the controlled-pilot Google-account requirement before onboarding submission.
- Modify `src/components/auth/AuthExperience.module.css`: align authentication surfaces with the same physical ledger treatment; no auth behaviour changes.
- Modify `src/app/(app)/app-shell.module.css`: refine shared navigation and workspace framing; no routes or state changes.
- Modify `src/components/overview/overview-workspace.module.css`: improve dashboard hierarchy while preserving rendered data and actions.
- Modify `__tests__/ui/public-copy.test.tsx`: assert approved copy, sample labelling, unchanged public header contract, and preview accessibility.
- Modify `__tests__/ui/overview-workspace.test.tsx`: retain existing functional assertions and add only stable hierarchy/accessibility assertions if markup changes.
- Create `tests/e2e/public-site.spec.ts`: desktop, tablet, and phone checks for public navigation, hero visibility, responsive overflow, and product-tour access.
- Modify `README.md`: record the final public/product experience and free-pilot constraints after verification.

## Task 1: Build the factual product-decision preview

**Files:**
- Create: `src/components/public/ProductDecisionPreview.tsx`
- Modify: `__tests__/ui/public-copy.test.tsx`
- Reference: `src/data/sample-procurement.ts`

- [ ] **Step 1: Write the failing public-preview contract**

Add the new component to `publicFiles`, then add this test:

```tsx
test('shows a factual product decision in the hero without inventing market data', () => {
  const preview = source('src/components/public/ProductDecisionPreview.tsx');

  expect(preview).toContain('Sample data');
  expect(preview).toContain('Sample request');
  expect(preview).toContain('Review & award');
  expect(preview).toContain('Human decision required');
  expect(preview).toContain('restaurantSampleQuotes.map');
  expect(preview).toContain('restaurantSampleRequest.items.length');
  expect(preview).toContain('Scroll to compare suppliers');
  expect(preview).not.toMatch(/live market|guaranteed|recommended supplier/i);
});
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```bash
npx jest __tests__/ui/public-copy.test.tsx --runInBand
```

Expected: FAIL because `ProductDecisionPreview.tsx` does not exist.

- [ ] **Step 3: Implement the server-rendered preview**

Create the component with this structure and no client directive:

```tsx
import Link from 'next/link';
import {
  formatSampleInr,
  restaurantSampleQuotes,
  restaurantSampleRequest,
} from '@/data/sample-procurement';

export function ProductDecisionPreview() {
  return (
    <figure className="decision-preview" aria-labelledby="decision-preview-title">
      <div className="decision-preview__shell">
        <div className="decision-preview__window">
          <header className="decision-preview__bar">
            <span className="decision-preview__traffic" aria-hidden="true"><i /><i /><i /></span>
            <strong id="decision-preview-title">Quote comparison</strong>
            <span>Sample data</span>
          </header>
          <div className="decision-preview__body">
            <aside aria-label="Sample workspace navigation">
              <strong>QuotePlate</strong>
              <span>Overview</span>
              <span className="is-active">Requests</span>
              <span>Suppliers</span>
              <span>History</span>
            </aside>
            <section>
              <div className="decision-preview__heading">
                <div>
                  <span>Sample request · {restaurantSampleRequest.id}</span>
                  <h2>{restaurantSampleRequest.cadence}</h2>
                </div>
                <span className="decision-preview__status">{restaurantSampleQuotes.length} quotes ready</span>
              </div>
              <p className="decision-preview__context">
                {restaurantSampleRequest.items.length} items · {restaurantSampleRequest.context}
              </p>
              <span className="decision-preview__scroll-hint">Scroll to compare suppliers →</span>
              <div className="decision-preview__table-wrap" tabIndex={0} role="region" aria-label="Sample supplier totals">
                <table>
                  <thead><tr><th>Supplier</th><th>Landed total</th><th>Coverage</th><th>Terms</th></tr></thead>
                  <tbody>
                    {restaurantSampleQuotes.map((quote) => (
                      <tr key={quote.supplierName}>
                        <th scope="row">{quote.supplierName}</th>
                        <td>{formatSampleInr(quote.totalPaise)}</td>
                        <td>{quote.coverageCount} / {restaurantSampleRequest.items.length}</td>
                        <td>{quote.terms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer>
                <span><i aria-hidden="true" /> Human decision required</span>
                <Link className="decision-preview__award" href="/product#compare">Review &amp; award</Link>
              </footer>
            </section>
          </div>
        </div>
      </div>
      <figcaption className="decision-preview__signal">
        <span aria-hidden="true" />
        <div><strong>Sample supplier response</strong><small>Illustrative prices · not live market data</small></div>
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 4: Run the public contract and verify it passes**

Run:

```bash
npx jest __tests__/ui/public-copy.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit the preview**

```bash
git add src/components/public/ProductDecisionPreview.tsx __tests__/ui/public-copy.test.tsx
git commit -m "feat: add factual product decision preview"
```

## Task 2: Replace the decorative landing hero with the approved A1 experience

**Files:**
- Modify: `src/components/public/PublicLandingPage.tsx`
- Modify: `src/app/globals.css`
- Test: `__tests__/ui/public-copy.test.tsx`

- [ ] **Step 1: Add the failing approved-copy and header-preservation assertions**

Add this test:

```tsx
test('uses the approved product-led hero while preserving the current header', () => {
  const landing = source('src/components/public/PublicLandingPage.tsx');
  const header = source('src/components/public/PublicHeader.tsx');

  expect(landing).toContain('Compare every quote.');
  expect(landing).toContain('Choose with proof.');
  expect(landing).toContain('<ProductDecisionPreview');
  expect(landing).toContain('No marketplace');
  expect(landing).toContain('No card required');
  expect(landing).toContain('Run the request again');
  expect(landing).not.toContain('public-hero__mark');
  expect(header).toContain('Product');
  expect(header).toContain('How it works');
  expect(header).toContain('Security');
  expect(header).toContain('Sign in');
  expect(header).toContain('Start a pilot');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx jest __tests__/ui/public-copy.test.tsx --runInBand
```

Expected: FAIL on the approved hero assertions.

- [ ] **Step 3: Update the landing-page structure**

Replace the current hero and separate preview section with:

```tsx
<section className="public-hero public-container">
  <div className="public-hero__copy public-reveal">
    <p className="public-eyebrow">Restaurant buying, made accountable</p>
    <h1>Compare every quote.<br /><em>Choose with proof.</em></h1>
    <p className="public-hero__lede">
      Send one ingredient request to your existing suppliers. {brand.productName} lines up price,
      delivery, coverage, GST, freight, and payment terms so your team can make and record the final choice.
    </p>
    <div className="public-hero__actions">
      <Link className="public-button" href="/product">See the product <span aria-hidden="true">→</span></Link>
      <Link className="public-inline-link" href="/start">Start a pilot <span aria-hidden="true">↗</span></Link>
    </div>
    <p className="public-hero__note">Controlled free pilot for approved restaurant workspaces. No marketplace, supplier commission, or card required.</p>
  </div>
  <ProductDecisionPreview />
</section>
```

Replace the four proof blocks with factual product signals:

```tsx
const proofPoints = [
  ['3 supplier replies', 'Shown in the labelled sample decision above.'],
  ['8 items requested', 'Coverage stays visible beside every supplier total.'],
  ['1 decision waiting', 'No supplier is chosen automatically.'],
  ['Human approval required', 'Your restaurant records the final choice.'],
];
```

Change the workflow introduction to:

```tsx
<h2 id="workflow-title">Useful for this order.<br />More useful for the next.</h2>
<p>
  Run the request again with the saved ingredients and suppliers, compare fresh terms with saved
  history, and keep the final decision attached to the facts your team reviewed.
</p>
```

- [ ] **Step 4: Implement the A1 CSS without changing the header**

Replace only the public hero, preview, and proof styles. The required shape is:

```css
.public-hero {
  min-height: min(46rem, calc(100dvh - 4.75rem));
  display: grid;
  grid-template-columns: minmax(20rem, 0.82fr) minmax(31rem, 1.18fr);
  align-items: center;
  gap: clamp(2rem, 5vw, 5.5rem);
  padding-block: clamp(4rem, 7vw, 6.5rem);
}

.public-hero h1 {
  max-width: 11ch;
  font-size: clamp(3.65rem, 6.4vw, 6.2rem);
  line-height: 0.88;
}

.decision-preview { position: relative; min-width: 0; margin: 0; }
.decision-preview__shell {
  padding: 0.45rem;
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  box-shadow: 0 2.25rem 5rem color-mix(in srgb, var(--raised-ink) 16%, transparent);
}
.decision-preview__window {
  overflow: hidden;
  border-radius: 0.95rem;
  background: #fbf8f1;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.88);
}
.decision-preview__body { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); }
.decision-preview__body > aside { background: var(--ink); color: var(--stone); }
.decision-preview__table-wrap { min-width: 0; overflow-x: auto; }
.decision-preview table { width: 100%; min-width: 31rem; border-collapse: collapse; }
.decision-preview__signal {
  position: absolute;
  right: -0.75rem;
  bottom: -1.5rem;
  display: flex;
  transform: translateY(0);
  animation: decision-signal-enter 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes decision-signal-enter {
  from { opacity: 0; transform: translateY(0.65rem); }
  to { opacity: 1; transform: translateY(0); }
}
```

At `max-width: 900px`, stack hero copy over preview. At `max-width: 620px`, make both actions full width, hide the preview sidebar, expose the scroll hint, keep the table scrollable, and place the response signal in normal flow. Add no header announcement strip and do not alter `.public-header*` styles.

- [ ] **Step 5: Run public tests, lint the changed files, and verify the build compiles**

Run:

```bash
npx jest __tests__/ui/public-copy.test.tsx --runInBand
npx eslint src/components/public/PublicLandingPage.tsx src/components/public/ProductDecisionPreview.tsx
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the landing experience**

```bash
git add src/components/public/PublicLandingPage.tsx src/app/globals.css __tests__/ui/public-copy.test.tsx
git commit -m "feat: make the homepage product led"
```

## Task 3: Harmonise the product tour and shared product surfaces

**Files:**
- Modify: `src/components/public/ProductTour.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/auth/AuthPageShell.tsx`
- Modify: `src/components/auth/AuthExperience.module.css`
- Modify: `src/app/(app)/app-shell.module.css`
- Modify: `src/components/overview/overview-workspace.module.css`
- Test: `__tests__/ui/public-copy.test.tsx`
- Test: `__tests__/ui/overview-workspace.test.tsx`
- Test: `__tests__/ui/mobile-navigation-contract.test.ts`

- [ ] **Step 1: Add stable product-polish contract assertions**

Add one source-level assertion that protects the design boundaries without snapshotting CSS values:

```tsx
test('keeps product polish dependency-free and preserves the signed-in navigation contract', () => {
  const packageJson = source('package.json');
  const publicCss = source('src/app/globals.css');
  const appShell = source('src/app/(app)/app-shell.module.css');

  expect(packageJson).not.toMatch(/framer-motion|gsap|lottie|three/);
  expect(publicCss).toContain('decision-preview__shell');
  expect(publicCss).toContain('prefers-reduced-motion: reduce');
  expect(appShell).toContain('.desktopSidebar');
  expect(appShell).toContain('.mobileOverlay');
});
```

- [ ] **Step 2: Run the affected UI tests before editing**

Run:

```bash
npx jest __tests__/ui/public-copy.test.tsx __tests__/ui/overview-workspace.test.tsx __tests__/ui/mobile-navigation-contract.test.ts --runInBand
```

Expected: PASS before visual-only changes; this establishes the behaviour baseline.

- [ ] **Step 3: Refine existing surfaces in place**

Apply these exact boundaries:

```css
/* Public product records: nested physical enclosure, no extra component layer. */
.tour-record,
.supplier-sheet,
.sample-ledger {
  border-color: color-mix(in srgb, var(--ink) 16%, transparent);
  background: #fbf8f1;
  box-shadow:
    inset 0 1px rgba(255, 255, 255, 0.82),
    0 1.5rem 4rem color-mix(in srgb, var(--raised-ink) 10%, transparent);
}

/* Shared signed-in shell: preserve width and navigation, improve depth only. */
.sidebarContent {
  margin: 0.75rem 0 0.75rem 0.75rem;
  height: calc(100% - 1.5rem);
  border: 1px solid var(--shell-line);
  border-radius: 0.9rem;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.78);
}

.content {
  margin: 0.75rem;
  overflow: clip;
  border: 1px solid var(--shell-line);
  border-radius: 0.9rem;
  background: var(--shell-stone);
}
```

Give the comparison tour section the real link target:

```tsx
<section className="tour-step tour-step--comparison" id="compare" aria-labelledby="tour-comparison-title">
```

Update the onboarding context before the form:

```tsx
start: {
  eyebrow: 'India pilot',
  title: 'Set up the workspace behind your next purchase.',
  description:
    'The controlled free pilot supports up to four approved restaurant workspaces. Use the Google account approved for your pilot.',
  document: 'Owner registration',
  note: 'No payment card is collected, and starting the pilot does not activate billing.',
},
```

On mobile, remove the workspace margins and radii, keep the current sticky header and drawer behaviour, and preserve 44px touch targets. In the overview stylesheet, keep all data and link structure but improve the page header, metric grouping, and panel rhythm using the existing palette. In the auth stylesheet, remove broad decorative gradient intensity, retain the grid and paper texture, and use the same nested sheet edge as the hero preview.

Do not change:

- navigation items or route order;
- authentication handlers, fields, or Google login behaviour;
- overview fetch logic, counts, deadlines, awards, empty states, or actions;
- procurement, menu, supplier, reporting, or settings business components.

- [ ] **Step 4: Run all affected UI tests**

Run:

```bash
npx jest __tests__/ui/public-copy.test.tsx __tests__/ui/overview-workspace.test.tsx __tests__/ui/mobile-navigation-contract.test.ts --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit shared product polish**

```bash
git add src/components/public/ProductTour.tsx src/app/globals.css src/components/auth/AuthPageShell.tsx src/components/auth/AuthExperience.module.css 'src/app/(app)/app-shell.module.css' src/components/overview/overview-workspace.module.css __tests__/ui/public-copy.test.tsx __tests__/ui/overview-workspace.test.tsx __tests__/ui/mobile-navigation-contract.test.ts
git commit -m "style: unify public and product surfaces"
```

## Task 4: Add responsive browser coverage and verify the launch path

**Files:**
- Create: `tests/e2e/public-site.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Write responsive public-site checks**

Create:

```ts
import { expect, test } from '@playwright/test';

const sizes = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1194 },
  { name: 'laptop', width: 1440, height: 960 },
];

for (const size of sizes) {
  test(`public site remains usable on ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Compare every quote. Choose with proof.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See the product →' })).toHaveAttribute('href', '/product');
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
    await expect(page.getByText('Human decision required')).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('product tour stays reachable from the hero', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'See the product →' }).click();
  await expect(page).toHaveURL(/\/product$/);
  await expect(page.getByText('01 / Request')).toBeVisible();
  await expect(page.getByText('03 / Compare and award')).toBeVisible();
});
```

- [ ] **Step 2: Run the focused browser suite**

Run:

```bash
npx playwright test tests/e2e/public-site.spec.ts --project=desktop-chromium
```

Expected: all responsive and navigation tests pass.

- [ ] **Step 3: Run complete quality gates**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: every command exits 0; Next.js collects all routes without a page-data error.

- [ ] **Step 4: Perform manual visual checks**

Verify `/`, `/product`, `/signin`, `/start`, and `/dashboard` at 390×844, 834×1112, and 1440×960. Confirm:

- the approved current header is visually unchanged;
- the product preview is readable and does not imply a recommended supplier;
- mobile tables scroll inside their own frame and the page has no horizontal overflow;
- focus rings are visible;
- reduced motion removes the response-signal entry;
- all sample data remains labelled;
- no payment or card field appears anywhere.

- [ ] **Step 5: Update README only with verified facts**

Add a concise `Product experience` section:

```md
## Product experience

QuotePlate is a product-led restaurant procurement workspace for India. The public site demonstrates the same request, supplier-response, comparison, and human-award flow used in the signed-in product, using clearly labelled sample data. The responsive interface supports phone, tablet, and laptop layouts and uses locally hosted open-source fonts and SVG brand assets.

The current pilot has no billing integration, collects no payment card, and is intended for up to four restaurants on manually controlled free infrastructure.
```

- [ ] **Step 6: Commit verified tests and documentation**

```bash
git add tests/e2e/public-site.spec.ts README.md
git commit -m "test: verify responsive QuotePlate experience"
```

## Task 5: Preview deployment and production handoff

**Files:**
- No source changes expected.

- [ ] **Step 1: Push the implementation branch**

```bash
git push -u origin codex/product-led-polish
```

Expected: GitHub accepts the branch and starts CI/Vercel preview checks.

- [ ] **Step 2: Open a pull request**

```bash
gh pr create --base main --head codex/product-led-polish --title "Polish QuotePlate with a product-led experience" --body-file /tmp/quoteplate-product-led-pr.md
```

Expected: a non-draft pull request URL is returned.

- [ ] **Step 3: Wait for required checks and inspect the preview**

Run:

```bash
gh pr checks --watch
```

Expected: all required checks pass. Open the Vercel preview and repeat the homepage, product, sign-in, start, and readiness checks.

- [ ] **Step 4: Merge only after verified preview approval**

```bash
gh pr merge --squash --delete-branch
```

Expected: the pull request merges to `main`, the remote feature branch is removed, and the production deployment begins without billing changes.

---

## Self-review

- Spec coverage: homepage, product tour, authentication, shared app shell, overview, phone/tablet/laptop behaviour, restrained motion, accessibility, no paid services, realistic sample data, README, and deployment are each mapped to a task.
- Placeholder scan: no `TBD`, `TODO`, unspecified tests, or undefined implementation helpers remain.
- Type consistency: the new component imports existing `formatSampleInr`, `restaurantSampleQuotes`, and `restaurantSampleRequest`; no new public types or runtime dependencies are introduced.
- Scope control: no database, API, authentication, procurement, supplier, menu, reporting, or billing logic is modified.
