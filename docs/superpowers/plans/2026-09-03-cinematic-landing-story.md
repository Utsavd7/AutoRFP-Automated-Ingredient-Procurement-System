# Cinematic Landing Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fast, responsive landing-page story that helps an Indian restaurant manager understand QuotePlate from menu intake through supplier choice, while giving an owner clear proof of control, privacy, and repeat value.

**Architecture:** Keep `/` statically rendered and add two focused presentational components: one shared Lucide icon wrapper and one ordered story component. Preserve `ProductDecisionPreview` as the main product proof, keep all animation in CSS, and use the existing sample procurement data as the only source for illustrative records.

**Tech Stack:** Next.js 16 App Router, React 19 server components, TypeScript, existing Lucide React icons, semantic HTML, CSS in `src/app/globals.css`, Jest, and Playwright.

---

## File Map

- Create `src/components/public/JourneyIcon.tsx`: constrained wrapper around individually imported Lucide icons.
- Create `src/components/public/LandingJourney.tsx`: semantic ordered story, product-style diagrams, comparison preview, privacy map, and repeat-value scene.
- Modify `src/components/public/PublicLandingPage.tsx`: new plain-English hero, compact route preview, story integration, and closing action.
- Modify `src/app/globals.css`: cinematic layout, shared diagram styling, responsive collapse, and reduced-motion fallback.
- Modify `__tests__/ui/public-copy.test.tsx`: static rendering, truthfulness, icon, privacy, and performance architecture contracts.
- Modify `tests/e2e/public-site.spec.ts`: responsive story order, overflow, links, and reduced-motion checks.

### Task 1: Lock the public story contract

**Files:**
- Modify: `__tests__/ui/public-copy.test.tsx`

- [ ] **Step 1: Replace the old hero expectation with the approved promise**

Update the existing `uses the approved product-led hero` test to assert the exact public promise and retained product proof:

```tsx
expect(markup).toContain('Send one list.');
expect(markup).toContain('Compare every supplier.');
expect(markup).toContain('Choose the best deal.');
expect(markup).toContain('Quote comparison');
expect(markup).toContain('Human decision required');
expect(markup).toContain('No card required');
expect(landing).toContain('<LandingJourney');
expect(landing).not.toContain("'use client'");
```

- [ ] **Step 2: Add a complete ordered-story contract**

Add this focused test in the same `public website contract` suite:

```tsx
test('explains the restaurant buying journey in familiar language', () => {
  const markup = renderToStaticMarkup(<PublicLandingPage />);
  const steps = [
    'Tell us what your kitchen needs',
    'Choose who should send prices',
    'Send one clear request',
    'Compare the complete cost',
    'Choose and save the decision',
  ];

  let previous = -1;
  for (const step of steps) {
    const position = markup.indexOf(step);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }

  expect(markup).toContain('Take menu photos');
  expect(markup).toContain('Use your existing suppliers');
  expect(markup).toContain('No supplier account needed');
  expect(markup).toContain('Prices, GST, delivery and missing items');
  expect(markup).toContain('Your restaurant makes the final choice');
});
```

- [ ] **Step 3: Add icon, privacy, and architecture contracts**

Extend `publicFiles` with the two new component paths, then add:

```tsx
test('uses one consistent icon family and keeps diagrams local', () => {
  const iconSource = source('src/components/public/JourneyIcon.tsx');
  const journeySource = source('src/components/public/LandingJourney.tsx');

  expect(iconSource).toContain("from 'lucide-react'");
  expect(iconSource).toContain('strokeWidth={1.8}');
  expect(journeySource).toContain('<JourneyIcon');
  expect(journeySource).not.toMatch(/https?:\/\/|<img|three|gsap/i);
});

test('makes recipe privacy understandable without security jargon', () => {
  const markup = renderToStaticMarkup(<PublicLandingPage />);

  expect(markup).toContain('Your recipes stay private with your restaurant.');
  expect(markup).toContain('Your restaurant team');
  expect(markup).toContain('Only the request sent to them');
  expect(markup).toContain('Other restaurants');
  expect(markup).toContain('Cannot see your information');
});
```

- [ ] **Step 4: Run the focused suite and confirm the new contract fails**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/public-copy.test.tsx
```

Expected: FAIL because `LandingJourney`, the new promise, and the new privacy map do not exist yet.

- [ ] **Step 5: Commit the failing contract**

```bash
git add __tests__/ui/public-copy.test.tsx
git commit -m "test: define cinematic landing story"
```

### Task 2: Build the consistent icon vocabulary

**Files:**
- Create: `src/components/public/JourneyIcon.tsx`
- Test: `__tests__/ui/public-copy.test.tsx`

- [ ] **Step 1: Implement one icon wrapper around the existing library**

Create the file with a fixed vocabulary and visual treatment:

```tsx
import {
  BadgeCheck,
  Camera,
  Columns3,
  History,
  IndianRupee,
  Link2,
  ListChecks,
  ReceiptText,
  ShieldCheck,
  Truck,
  Upload,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

const journeyIcons = {
  approve: BadgeCheck,
  camera: Camera,
  compare: Columns3,
  history: History,
  price: IndianRupee,
  link: Link2,
  list: ListChecks,
  receipt: ReceiptText,
  privacy: ShieldCheck,
  delivery: Truck,
  upload: Upload,
  suppliers: UsersRound,
} satisfies Record<string, LucideIcon>;

export type JourneyIconName = keyof typeof journeyIcons;

export function JourneyIcon({ name }: { name: JourneyIconName }) {
  const Icon = journeyIcons[name];
  return (
    <span className="journey-icon" aria-hidden="true">
      <Icon size={22} strokeWidth={1.8} />
    </span>
  );
}
```

- [ ] **Step 2: Run the focused icon contract**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/public-copy.test.tsx
```

Expected: the icon assertions pass; story and privacy assertions still fail.

- [ ] **Step 3: Commit the icon vocabulary**

```bash
git add src/components/public/JourneyIcon.tsx
git commit -m "feat: add consistent landing journey icons"
```

### Task 3: Build the ordered restaurant buying story

**Files:**
- Create: `src/components/public/LandingJourney.tsx`
- Test: `__tests__/ui/public-copy.test.tsx`

- [ ] **Step 1: Implement the static semantic journey**

Create a server component using one ordered list and short restaurant language. Keep the existing comparison component as the fourth scene:

```tsx
import { ProductDecisionPreview } from './ProductDecisionPreview';
import { JourneyIcon, type JourneyIconName } from './JourneyIcon';

const intake = [
  ['camera', 'Take menu photos'],
  ['upload', 'Upload existing photos'],
  ['list', 'Type dishes or ingredients'],
] satisfies ReadonlyArray<readonly [JourneyIconName, string]>;

const categories = [
  'Vegetables',
  'Fruits',
  'Dairy',
  'Dry goods',
  'Beverages',
  'Outsourced snacks',
] as const;

export function LandingJourney() {
  return (
    <section className="landing-story" id="how-it-works" aria-labelledby="landing-story-title">
      <header className="public-container landing-story__intro">
        <p className="public-eyebrow">One buying journey</p>
        <h2 id="landing-story-title">From today&apos;s menu to tomorrow&apos;s order.</h2>
        <p>See what happens at every step. Nothing is sent or selected without your team.</p>
      </header>

      <ol className="landing-story__track">
        <li className="story-scene story-scene--intake">
          <div className="story-scene__copy">
            <span className="story-scene__number">1</span>
            <h3>Tell us what your kitchen needs</h3>
            <p>Start from a menu or enter the items yourself. Your team checks the list before it is used.</p>
          </div>
          <div className="intake-diagram" aria-label="Three ways to add a menu or ingredient list">
            {intake.map(([icon, label]) => (
              <div key={label}><JourneyIcon name={icon} /><span>{label}</span></div>
            ))}
          </div>
        </li>

        <li className="story-scene story-scene--suppliers">
          <div className="story-scene__copy">
            <span className="story-scene__number">2</span>
            <h3>Choose who should send prices</h3>
            <p>Use your existing suppliers, choose suppliers for particular items, or stay open to verified new suppliers.</p>
          </div>
          <div className="supplier-diagram" aria-label="Supplier categories selected by the restaurant">
            <div className="supplier-diagram__centre"><JourneyIcon name="suppliers" /><strong>Your suppliers</strong></div>
            <ul>{categories.map((category) => <li key={category}>{category}</li>)}</ul>
          </div>
        </li>

        <li className="story-scene story-scene--request">
          <div className="story-scene__copy">
            <span className="story-scene__number">3</span>
            <h3>Send one clear request</h3>
            <p>Every selected supplier receives the same quantities, delivery need and terms. No supplier account needed.</p>
          </div>
          <div className="request-route" aria-label="One private request sent to three suppliers">
            <div><JourneyIcon name="list" /><strong>One request</strong></div>
            <span aria-hidden="true" />
            <ul><li>Vegetable supplier</li><li>Dairy supplier</li><li>Dry goods supplier</li></ul>
          </div>
        </li>

        <li className="story-scene story-scene--comparison">
          <div className="story-scene__copy">
            <span className="story-scene__number">4</span>
            <h3>Compare the complete cost</h3>
            <p>Prices, GST, delivery and missing items stay together. A lower total is useful only when the supplier can deliver what you need.</p>
          </div>
          <ProductDecisionPreview />
        </li>

        <li className="story-scene story-scene--decision">
          <div className="story-scene__copy">
            <span className="story-scene__number">5</span>
            <h3>Choose and save the decision</h3>
            <p>Your restaurant makes the final choice. QuotePlate keeps the order, approval and price history ready for the next purchase.</p>
          </div>
          <div className="decision-route" aria-label="Restaurant decision saved for the next order">
            <div><JourneyIcon name="approve" /><span>Supplier selected</span></div>
            <span aria-hidden="true" />
            <div><JourneyIcon name="history" /><span>Saved buying history</span></div>
          </div>
        </li>
      </ol>
    </section>
  );
}
```

- [ ] **Step 2: Run the focused suite**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/public-copy.test.tsx
```

Expected: ordered story and icon tests pass; new hero and privacy expectations still fail.

- [ ] **Step 3: Commit the ordered story**

```bash
git add src/components/public/LandingJourney.tsx __tests__/ui/public-copy.test.tsx
git commit -m "feat: explain restaurant buying as a visual story"
```

### Task 4: Integrate the story, privacy map, and closing action

**Files:**
- Modify: `src/components/public/PublicLandingPage.tsx`
- Test: `__tests__/ui/public-copy.test.tsx`

- [ ] **Step 1: Replace the home-page narrative while preserving shared navigation**

Import `LandingJourney`, retain the sample-data proof band, and structure the page in this order:

```tsx
import { JourneyIcon } from './JourneyIcon';
import { LandingJourney } from './LandingJourney';
```

```tsx
<main id="main-content">
  <section className="public-hero public-container">
    <div className="public-hero__copy public-reveal">
      <p className="public-eyebrow">Restaurant buying, made clear</p>
      <h1>Send one list.<br />Compare every supplier.<br /><em>Choose the best deal.</em></h1>
      <p className="public-hero__lede">
        Use the suppliers you already know. Compare prices, GST, delivery,
        missing items and payment terms before your restaurant chooses.
      </p>
      <div className="public-hero__actions">
        <Link className="public-button" href="/product">See the product <span aria-hidden="true">→</span></Link>
        <Link className="public-inline-link" href="/start">Start free pilot <span aria-hidden="true">↗</span></Link>
      </div>
      <p className="public-hero__note">No supplier commission. No card required.</p>
    </div>
    <div className="hero-route" aria-label="QuotePlate buying journey">
      <span>Menu</span><i aria-hidden="true" /><span>Request</span><i aria-hidden="true" />
      <span>Supplier prices</span><i aria-hidden="true" /><span>Your choice</span>
    </div>
  </section>

  <LandingJourney />

  <section className="privacy-story" id="security" aria-labelledby="privacy-story-title">
    <div className="public-container privacy-story__grid">
      <div>
        <JourneyIcon name="privacy" />
        <h2 id="privacy-story-title">Your recipes stay private with your restaurant.</h2>
        <p>Your recipes, menus, supplier prices, and purchase records stay private to your restaurant. Other restaurants cannot see them, and suppliers see only the request you send to them.</p>
      </div>
      <dl className="privacy-map">
        <div><dt>Your restaurant team</dt><dd>Menus, recipes, suppliers, quotes and buying history</dd></div>
        <div><dt>Each supplier</dt><dd>Only the request sent to them</dd></div>
        <div><dt>Other restaurants</dt><dd>Cannot see your information</dd></div>
      </dl>
      <p className="privacy-story__note">Private supplier links expire. Quote changes and decisions stay recorded for your restaurant team.</p>
    </div>
  </section>

  <section className="public-cta public-container" aria-labelledby="pilot-title">
    <div><h2 id="pilot-title">Try QuotePlate with one real purchase.</h2></div>
    <div>
      <p>Start with one ingredient request and the suppliers your restaurant already uses. The pilot needs no payment card.</p>
      <div className="public-hero__actions">
        <Link className="public-button" href="/start">Start free pilot <span aria-hidden="true">→</span></Link>
        <Link className="public-inline-link" href="/product">See the product</Link>
      </div>
    </div>
  </section>
</main>
```

Keep the existing `proofPoints` values derived from `restaurantSampleQuotes` and `restaurantSampleRequest`; place the proof band after the hero or comparison scene without inventing activity.

- [ ] **Step 2: Run the public copy contract**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/public-copy.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit the integrated narrative**

```bash
git add src/components/public/PublicLandingPage.tsx __tests__/ui/public-copy.test.tsx
git commit -m "feat: integrate cinematic landing narrative"
```

### Task 5: Create the cinematic layout without adding runtime weight

**Files:**
- Modify: `src/app/globals.css`
- Test: `tests/e2e/public-site.spec.ts`

- [ ] **Step 1: Add the connected route and scene foundations**

Add styles using the existing color tokens. The exact layout foundation is:

```css
.hero-route {
  min-height: 22rem;
  display: grid;
  grid-template-columns: repeat(7, auto);
  align-items: center;
  justify-content: center;
  gap: clamp(0.55rem, 1.5vw, 1.25rem);
  padding: clamp(1.5rem, 4vw, 3rem);
  color: var(--ink);
}

.hero-route span {
  display: grid;
  min-height: 5rem;
  place-items: center;
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--ink) 24%, transparent);
  border-radius: 12px;
  background: #fbf8f1;
  font-size: 0.78rem;
  font-weight: 720;
  text-align: center;
}

.hero-route i,
.decision-route > span {
  width: clamp(1rem, 3vw, 3rem);
  height: 1px;
  background: var(--copper);
  transform-origin: left;
  animation: route-draw 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.landing-story {
  padding-block: clamp(5rem, 10vw, 9rem);
  background: var(--raised-ink);
  color: var(--stone);
}

.landing-story__intro {
  max-width: 54rem;
  margin-bottom: clamp(4rem, 8vw, 7rem);
}

.landing-story__intro h2,
.privacy-story h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.7rem, 6vw, 5.5rem);
  font-weight: 470;
  letter-spacing: -0.04em;
  line-height: 0.95;
  text-wrap: balance;
}

.landing-story__track {
  width: min(100% - 2rem, 76rem);
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.story-scene {
  min-height: min(48rem, 92dvh);
  display: grid;
  grid-template-columns: minmax(17rem, 4fr) minmax(0, 7fr);
  align-items: center;
  gap: clamp(3rem, 8vw, 8rem);
  padding-block: clamp(4rem, 8vw, 7rem);
  border-top: 1px solid color-mix(in srgb, var(--stone) 18%, transparent);
}

.story-scene__copy h3 {
  margin: 1rem 0;
  font-size: clamp(1.7rem, 3vw, 2.8rem);
  letter-spacing: -0.035em;
  line-height: 1.05;
  text-wrap: balance;
}

.story-scene__copy p {
  max-width: 33rem;
  margin: 0;
  color: color-mix(in srgb, var(--stone) 78%, transparent);
  line-height: 1.7;
}

.story-scene__number {
  color: var(--copper);
  font-size: 0.8rem;
  font-weight: 780;
}

@keyframes route-draw {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
```

- [ ] **Step 2: Style diagrams as product records, not generic icon cards**

Use shared borders, surfaces, and alignment for `.intake-diagram`, `.supplier-diagram`, `.request-route`, `.decision-route`, and `.privacy-map`. Apply one shared `.journey-icon` rule:

```css
.journey-icon {
  width: 2.75rem;
  height: 2.75rem;
  display: inline-grid;
  place-items: center;
  color: var(--copper);
}

.intake-diagram,
.supplier-diagram,
.request-route,
.decision-route {
  border: 1px solid color-mix(in srgb, var(--stone) 23%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--stone) 7%, transparent);
}

.privacy-story {
  padding-block: clamp(5rem, 10vw, 9rem);
  background: var(--stone);
  color: var(--ink);
}

.privacy-story__grid {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(22rem, 4fr);
  gap: clamp(3rem, 9vw, 9rem);
  align-items: center;
}

.privacy-map {
  margin: 0;
  border-block: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
}

.privacy-map div {
  display: grid;
  grid-template-columns: 9rem 1fr;
  gap: 1.5rem;
  padding: 1.4rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
}

.privacy-story__note {
  grid-column: 2;
  max-width: 34rem;
  margin: 0;
  color: var(--ink-label);
  line-height: 1.65;
}
```

Do not apply wide decorative shadows to the bordered diagram surfaces. Preserve the existing `ProductDecisionPreview` styling unchanged except for story-specific width and spacing.

- [ ] **Step 3: Add mobile and reduced-motion behaviour**

Append:

```css
@media (max-width: 900px) {
  .hero-route {
    min-height: auto;
    grid-template-columns: 1fr;
  }

  .hero-route i {
    width: 1px;
    height: 1.25rem;
    transform-origin: top;
  }

  .story-scene,
  .privacy-story__grid {
    min-height: auto;
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
}

@media (max-width: 620px) {
  .landing-story__track {
    width: min(100% - 1.25rem, 76rem);
  }

  .story-scene {
    padding-block: 4rem;
  }

  .privacy-map div {
    grid-template-columns: 1fr;
    gap: 0.45rem;
  }

  .privacy-story__note {
    grid-column: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-route i,
  .decision-route > span {
    animation: none;
    transform: none;
  }
}
```

- [ ] **Step 4: Update the responsive end-to-end contract**

Change the home heading locator to `/Send one list/i`, assert the story and privacy headings at laptop, tablet, and phone sizes, and add:

```ts
await expect(page.getByRole('heading', { level: 2, name: /From today.s menu/i })).toBeVisible();
await expect(page.getByRole('heading', { level: 3, name: 'Compare the complete cost' })).toBeVisible();
await expect(page.getByRole('heading', { level: 2, name: /Your recipes stay private/i })).toBeVisible();
await expectNoPageOverflow(page);
```

Add a reduced-motion test:

```ts
test('keeps the complete story visible with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: /Send one list/i })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Choose and save the decision' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Your recipes stay private/i })).toBeVisible();
});
```

- [ ] **Step 5: Run the public UI suites**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/public-copy.test.tsx
npx playwright test tests/e2e/public-site.spec.ts --project=desktop-chromium
```

Expected: both suites pass at all configured viewport sizes.

- [ ] **Step 6: Commit the finished visual system**

```bash
git add src/app/globals.css tests/e2e/public-site.spec.ts
git commit -m "feat: style the cinematic restaurant buying story"
```

### Task 6: Verify scope, quality, and production readiness

**Files:**
- Verify: `src/components/public/PublicLandingPage.tsx`
- Verify: `src/components/public/LandingJourney.tsx`
- Verify: `src/components/public/JourneyIcon.tsx`
- Verify: `src/app/globals.css`
- Verify: `package.json`
- Verify: `prisma/`
- Verify: `src/app/api/`

- [ ] **Step 1: Confirm forbidden scope did not change**

Run from the feature branch using its merge base with `main`:

```bash
git diff --exit-code main...HEAD -- package.json package-lock.json prisma src/app/api src/lib
```

Expected: exit code 0 and no output. This proves the redesign added no dependency, database, API, billing, authentication, or product-logic change.

- [ ] **Step 2: Run the full automated verification**

Run sequentially:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits 0; the production build completes all routes.

- [ ] **Step 3: Check source integrity and size**

Run:

```bash
git diff --check
git diff --stat main...HEAD
rg -n "three|gsap|https?://|use client" src/components/public/LandingJourney.tsx src/components/public/JourneyIcon.tsx
```

Expected: no whitespace errors; the two new components contain no Three.js, GSAP, remote asset, or client-component usage.

- [ ] **Step 4: Review the final requirement checklist**

Confirm all of the following from rendered markup and test output:

- a manager can follow menu, ingredients, suppliers, quotes, decision, and history in order;
- an owner can see full-cost comparison, human control, repeat value, and recipe privacy;
- `ProductDecisionPreview` retains its current visual identity and sample labels;
- the QuotePlate logo remains unchanged;
- icons come from Lucide and diagrams follow the product UI system;
- phone layouts do not trap scroll or overflow horizontally;
- reduced motion shows all content;
- no billing, paid API, database, or environment configuration changed.

- [ ] **Step 5: Commit any verification-only corrections**

If a verification command required a focused source correction, stage only the affected landing files and commit:

```bash
git add src/components/public src/app/globals.css __tests__/ui/public-copy.test.tsx tests/e2e/public-site.spec.ts
git commit -m "fix: complete landing story verification"
```

If no correction was required, leave the branch unchanged.
