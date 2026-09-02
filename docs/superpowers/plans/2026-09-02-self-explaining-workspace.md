# Self-explaining Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every main QuotePlate workspace screen explain its purpose and next action in plain language for an Indian restaurant owner, manager, or chef.

**Architecture:** Keep the current routes, data contracts, components, and responsive shell. Change only visible copy, status presentation, page hierarchy, and a compact privacy reassurance in the existing workspace shell; test each customer-facing contract before changing its implementation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Jest, React DOM server rendering

---

### Task 1: Task-led navigation and setup guide

**Files:**
- Modify: `__tests__/ui/mobile-navigation-contract.test.ts`
- Modify: `__tests__/ui/tutorial-guide.test.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/app-shell.module.css`
- Modify: `src/components/tutorial/TutorialGuide.tsx`

- [ ] **Step 1: Write the failing navigation and guide expectations**

Add these assertions to the navigation contract after loading `source`:

```ts
for (const label of [
  'Home',
  'Buy ingredients',
  'Menu and ingredients',
  'Suppliers',
  'Savings and prices',
  'Past purchases',
  'Restaurant settings',
  'Ask suppliers for prices',
]) {
  expect(source).toContain(label);
}
expect(source).toContain('Private to your restaurant');
expect(source).toContain('Recipes, supplier prices, and purchase records stay here.');
```

Replace the expected tutorial actions with:

```ts
expect(TUTORIAL_STEPS.map(({ action, href }) => ({ action, href }))).toEqual([
  { action: 'Open home', href: '/dashboard' },
  { action: 'Open menu and ingredients', href: '/menus' },
  { action: 'Open suppliers', href: '/suppliers' },
  { action: 'Ask suppliers for prices', href: '/procurement/new' },
  { action: 'Compare supplier prices', href: '/procurement' },
  { action: 'Open savings and prices', href: '/insights' },
]);
```

Update the first-step markup expectation from `Open overview` to `Open home`.

- [ ] **Step 2: Run the focused tests and confirm the new contract fails**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/mobile-navigation-contract.test.ts __tests__/ui/tutorial-guide.test.tsx
```

Expected: FAIL because the old workspace and guide labels are still rendered.

- [ ] **Step 3: Apply the task-led labels and persistent privacy reassurance**

Replace `NAV` and the primary action text in `layout.tsx` with:

```tsx
const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { href: '/procurement', icon: ClipboardList, label: 'Buy ingredients' },
  { href: '/menus', icon: BookOpen, label: 'Menu and ingredients' },
  { href: '/suppliers', icon: Users, label: 'Suppliers' },
  { href: '/insights', icon: BarChart3, label: 'Savings and prices' },
  { href: '/history', icon: History, label: 'Past purchases' },
  { href: '/settings', icon: Settings, label: 'Restaurant settings' },
] as const;
```

```tsx
<Link className={styles.newRequest} href="/procurement/new" onClick={onNav}>
  <Plus aria-hidden="true" /> Ask suppliers for prices
</Link>
```

Place this compact reassurance before the account block:

```tsx
<aside className={styles.privacyNote} aria-label="Restaurant data privacy">
  <strong>Private to your restaurant</strong>
  <span>Recipes, supplier prices, and purchase records stay here.</span>
</aside>
```

Add restrained styles that fit the existing sidebar width:

```css
.privacyNote {
  margin-top: auto;
  padding: 0.9rem 0;
  border-top: 1px solid var(--shell-line);
  color: var(--shell-muted);
}

.privacyNote strong,
.privacyNote span {
  display: block;
}

.privacyNote strong {
  color: var(--shell-ink);
  font-size: 0.78rem;
}

.privacyNote span {
  margin-top: 0.25rem;
  font-size: 0.7rem;
  line-height: 1.45;
}
```

Rewrite `TUTORIAL_STEPS` so its instructions use the new labels and direct verbs:

```tsx
export const TUTORIAL_STEPS = [
  {
    title: 'See what needs attention',
    instruction: 'Open Home to see requests, quotes, menus, and supplier work that need attention today.',
    action: 'Open home',
    href: '/dashboard',
  },
  {
    title: 'Add your menu',
    instruction: 'Open Menu and ingredients. Type dish names, upload menu photos, or use a permitted website link. Check the dishes and ingredients before saving.',
    action: 'Open menu and ingredients',
    href: '/menus',
  },
  {
    title: 'Add the suppliers you trust',
    instruction: 'Open Suppliers. Add the businesses you already buy from and choose what each one can supply.',
    action: 'Open suppliers',
    href: '/suppliers',
  },
  {
    title: 'Ask for prices',
    instruction: 'Choose Ask suppliers for prices. Pick a checked menu, select the ingredients, enter the delivery date, and choose suppliers.',
    action: 'Ask suppliers for prices',
    href: '/procurement/new',
  },
  {
    title: 'Choose using the final cost',
    instruction: 'Open Buy ingredients. Choose a request, compare the final cost and delivery details, then record the supplier you select.',
    action: 'Compare supplier prices',
    href: '/procurement',
  },
  {
    title: 'Use your buying history',
    instruction: 'Open Savings and prices to see supplier response, submitted price differences, and facts from previous purchases.',
    action: 'Open savings and prices',
    href: '/insights',
  },
] as const;
```

- [ ] **Step 4: Run the navigation and guide tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit the navigation language**

```bash
git add __tests__/ui/mobile-navigation-contract.test.ts __tests__/ui/tutorial-guide.test.tsx 'src/app/(app)/layout.tsx' 'src/app/(app)/app-shell.module.css' src/components/tutorial/TutorialGuide.tsx
git commit -m "feat: make workspace navigation task led"
```

### Task 2: Self-explaining main pages

**Files:**
- Modify: `__tests__/ui/overview-workspace.test.tsx`
- Modify: `__tests__/ui/procurement-workspace.test.tsx`
- Modify: `__tests__/ui/menu-workspace.test.tsx`
- Modify: `__tests__/ui/supplier-workspace.test.tsx`
- Modify: `__tests__/ui/reporting-workspaces.test.tsx`
- Modify: `__tests__/ui/settings-workspace.test.tsx`
- Modify: `src/components/overview/OverviewWorkspace.tsx`
- Modify: `src/components/procurement/ProcurementWorkspace.tsx`
- Modify: `src/components/menus/MenuWorkspace.tsx`
- Modify: `src/components/suppliers/SupplierWorkspace.tsx`
- Modify: `src/components/reporting/InsightsWorkspace.tsx`
- Modify: `src/components/reporting/HistoryWorkspace.tsx`
- Modify: `src/components/settings/SettingsWorkspace.tsx`

- [ ] **Step 1: Add failing assertions for every main page contract**

In the matching rendered-component tests, assert these exact title and explanation pairs:

```ts
expect(html).toContain('What needs your attention today?');
expect(html).toContain('See requests, quotes, menus, and supplier work that need attention today.');

expect(html).toContain('Buy ingredients');
expect(html).toContain('Ask suppliers for prices, compare the final cost, and record who you choose.');

expect(html).toContain('Menu and ingredients');
expect(html).toContain('Add dishes, check their ingredients, and prepare them for a buying request.');

expect(html).toContain('Keep the suppliers you already use and what each one can supply in one place.');

expect(html).toContain('Savings and prices');
expect(html).toContain('See supplier response, submitted price differences, and facts from previous buying.');

expect(html).toContain('Past purchases');
expect(html).toContain('Find earlier requests and decisions, then repeat a purchase when needed.');

expect(html).toContain('Restaurant settings');
expect(html).toContain('Update restaurant details, team access, and workspace preferences.');
```

Keep each assertion in the test that already owns the relevant component instead of creating a cross-component snapshot.

For each existing load-error fixture, also assert this recovery message:

```ts
expect(html).toContain('Your saved restaurant records are unchanged.');
expect(html).toContain('Try again');
```

- [ ] **Step 2: Run the main-page UI tests and confirm failure**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/overview-workspace.test.tsx __tests__/ui/procurement-workspace.test.tsx __tests__/ui/menu-workspace.test.tsx __tests__/ui/supplier-workspace.test.tsx __tests__/ui/reporting-workspaces.test.tsx __tests__/ui/settings-workspace.test.tsx
```

Expected: FAIL on the new customer-facing titles and explanations.

- [ ] **Step 3: Replace the main page headings and primary actions**

Use these exact headings and descriptions while preserving the existing JSX structure and event handlers:

```tsx
// OverviewWorkspace
<p className={styles.eyebrow}>Your restaurant today</p>
<h1>What needs your attention today?</h1>
<p className={styles.intro}>See requests, quotes, menus, and supplier work that need attention today.</p>
// Primary action: Ask suppliers for prices

// ProcurementWorkspace
<p className={styles.eyebrow}>Restaurant buying</p>
<h1>Buy ingredients</h1>
<p className={styles.intro}>Ask suppliers for prices, compare the final cost, and record who you choose.</p>
// Primary and empty-state action: Ask suppliers for prices

// MenuWorkspace
<p className={styles.eyebrow}>Prepare what you need</p>
<h1>Menu and ingredients</h1>
<p className={styles.intro}>Add dishes, check their ingredients, and prepare them for a buying request.</p>

// SupplierWorkspace
<p className={styles.eyebrow}>People you buy from</p>
<h1>Suppliers</h1>
<p className={styles.intro}>Keep the suppliers you already use and what each one can supply in one place.</p>

// InsightsWorkspace
<p>Your buying facts</p>
<h1>Savings and prices</h1>
<span>See supplier response, submitted price differences, and facts from previous buying.</span>

// HistoryWorkspace
<p>Your buying record</p>
<h1>Past purchases</h1>
<span>Find earlier requests and decisions, then repeat a purchase when needed.</span>
// Primary action: Ask suppliers for prices

// SettingsWorkspace
<p className={styles.eyebrow}>Your restaurant</p>
<h1>Restaurant settings</h1>
<span>Update restaurant details, team access, and workspace preferences.</span>
```

Update each matching empty-state button so it uses the same primary action label as the page header.

On read-only load errors, retain the existing specific error and retry control, then add:

```tsx
<span>Your saved restaurant records are unchanged.</span>
```

Do not add this statement to mutation errors where the server response is the source of truth.

- [ ] **Step 4: Run the main-page UI tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit the page language**

```bash
git add __tests__/ui/overview-workspace.test.tsx __tests__/ui/procurement-workspace.test.tsx __tests__/ui/menu-workspace.test.tsx __tests__/ui/supplier-workspace.test.tsx __tests__/ui/reporting-workspaces.test.tsx __tests__/ui/settings-workspace.test.tsx src/components/overview/OverviewWorkspace.tsx src/components/procurement/ProcurementWorkspace.tsx src/components/menus/MenuWorkspace.tsx src/components/suppliers/SupplierWorkspace.tsx src/components/reporting/InsightsWorkspace.tsx src/components/reporting/HistoryWorkspace.tsx src/components/settings/SettingsWorkspace.tsx
git commit -m "feat: explain every workspace page"
```

### Task 3: Plain form language and understandable statuses

**Files:**
- Modify: `__tests__/ui/new-request-form.test.tsx`
- Modify: `__tests__/ui/procurement-workspace.test.tsx`
- Modify: `__tests__/ui/request-detail.test.tsx`
- Modify: `__tests__/ui/reporting-workspaces.test.tsx`
- Modify: `src/components/procurement/NewRequestForm.tsx`
- Modify: `src/components/procurement/DraftRequestEditor.tsx`
- Modify: `src/components/procurement/ProcurementWorkspace.tsx`
- Modify: `src/components/procurement/RequestDetail.tsx`
- Modify: `src/components/reporting/HistoryWorkspace.tsx`

- [ ] **Step 1: Define the plain-language form and status contract in tests**

Add focused expectations to the owning tests:

```ts
expect(html).toContain('Payment and order terms');
expect(html).toContain('Items you need');
expect(html).toContain('Compare supplier prices');

for (const label of ['Not sent', 'Waiting for suppliers', 'Supplier selected', 'Cancelled']) {
  expect(html).toContain(label);
}
```

When a fixture does not render all statuses, assert the complete mapping from component source and assert rendered text only for fixture statuses.

- [ ] **Step 2: Run the procurement UI tests and confirm failure**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/new-request-form.test.tsx __tests__/ui/procurement-workspace.test.tsx __tests__/ui/request-detail.test.tsx __tests__/ui/reporting-workspaces.test.tsx
```

Expected: FAIL on the old internal terms.

- [ ] **Step 3: Translate terminology without changing stored values**

Use this status mapping in the procurement list, request detail, and purchase history:

```ts
const statusLabel = {
  DRAFT: 'Not sent',
  OPEN: 'Waiting for suppliers',
  AWARDED: 'Supplier selected',
  CANCELLED: 'Cancelled',
} as const;
```

Change visible section labels only:

```tsx
<h2>Payment and order terms</h2>
<p>Add only the payment or order details every supplier should see.</p>

<span>Payment and order terms</span>

<p className={styles.eyebrow}>Items you need</p>
<h2>Requested items</h2>

<p className={styles.eyebrow}>Compare supplier prices</p>
<h2>Supplier quotes</h2>

<p className={styles.eyebrow}>Your decision</p>
<h3>Record the supplier you choose</h3>
<p>QuotePlate shows the prices and terms. Your restaurant makes the final choice.</p>
```

- [ ] **Step 4: Run the procurement UI tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit the plain-language workflow**

```bash
git add __tests__/ui/new-request-form.test.tsx __tests__/ui/procurement-workspace.test.tsx __tests__/ui/request-detail.test.tsx __tests__/ui/reporting-workspaces.test.tsx src/components/procurement/NewRequestForm.tsx src/components/procurement/DraftRequestEditor.tsx src/components/procurement/ProcurementWorkspace.tsx src/components/procurement/RequestDetail.tsx src/components/reporting/HistoryWorkspace.tsx
git commit -m "feat: translate procurement language for restaurants"
```

### Task 4: Explicit recipe and commercial-data privacy

**Files:**
- Modify: `__tests__/ui/public-copy.test.tsx`
- Modify: `__tests__/ui/menu-workspace.test.tsx`
- Modify: `src/components/public/PublicLandingPage.tsx`
- Modify: `src/components/menus/MenuWorkspace.tsx`

- [ ] **Step 1: Add failing privacy promise assertions**

Add the full customer promise to the public test:

```ts
const privacyPromise = 'Your recipes, menus, supplier prices, and purchase records stay private to your restaurant.';
expect(markup).toContain(privacyPromise);
expect(markup).toContain('Other restaurants cannot see them');
expect(markup).toContain('suppliers see only the request you send to them');
```

Add the shorter in-workflow reassurance to the menu test:

```ts
expect(html).toContain('Your recipes and menus stay private to your restaurant.');
expect(html).toContain('Nothing is sent to suppliers until you open a buying request.');
```

- [ ] **Step 2: Run the two privacy-facing UI tests and confirm failure**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/public-copy.test.tsx __tests__/ui/menu-workspace.test.tsx
```

Expected: FAIL because the complete promise is not visible yet.

- [ ] **Step 3: Put the promise at the two trust decisions**

Replace the first public security point with:

```tsx
<article>
  <span>01</span>
  <div>
    <h3>Your restaurant records stay private</h3>
    <p>Your recipes, menus, supplier prices, and purchase records stay private to your restaurant. Other restaurants cannot see them, and suppliers see only the request you send to them.</p>
  </div>
</article>
```

Add this sentence to the existing menu explainer rather than creating another card:

```tsx
<small>Your recipes and menus stay private to your restaurant. Nothing is sent to suppliers until you open a buying request.</small>
```

- [ ] **Step 4: Run the privacy-facing tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit the privacy language**

```bash
git add __tests__/ui/public-copy.test.tsx __tests__/ui/menu-workspace.test.tsx src/components/public/PublicLandingPage.tsx src/components/menus/MenuWorkspace.tsx
git commit -m "feat: state restaurant data privacy plainly"
```

### Task 5: Metadata and complete verification

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/(app)/procurement/page.tsx`
- Modify: `src/app/(app)/procurement/new/page.tsx`
- Modify: `src/app/(app)/menus/page.tsx`
- Modify: `src/app/(app)/suppliers/page.tsx`
- Modify: `src/app/(app)/insights/page.tsx`
- Modify: `src/app/(app)/history/page.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Align browser titles with visible task labels**

Use these metadata titles on the matching pages:

```ts
export const metadata = { title: 'Home · QuotePlate' };
export const metadata = { title: 'Buy ingredients · QuotePlate' };
export const metadata = { title: 'Ask suppliers for prices · QuotePlate' };
export const metadata = { title: 'Menu and ingredients · QuotePlate' };
export const metadata = { title: 'Suppliers · QuotePlate' };
export const metadata = { title: 'Savings and prices · QuotePlate' };
export const metadata = { title: 'Past purchases · QuotePlate' };
export const metadata = { title: 'Restaurant settings · QuotePlate' };
```

- [ ] **Step 2: Run all focused UI tests**

Run:

```bash
npm test -- --runTestsByPath __tests__/ui/mobile-navigation-contract.test.ts __tests__/ui/tutorial-guide.test.tsx __tests__/ui/overview-workspace.test.tsx __tests__/ui/procurement-workspace.test.tsx __tests__/ui/menu-workspace.test.tsx __tests__/ui/supplier-workspace.test.tsx __tests__/ui/reporting-workspaces.test.tsx __tests__/ui/settings-workspace.test.tsx __tests__/ui/new-request-form.test.tsx __tests__/ui/request-detail.test.tsx __tests__/ui/public-copy.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run static and production checks**

Run:

```bash
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: all commands exit successfully and the production build completes without route errors.

- [ ] **Step 4: Confirm the change did not expand infrastructure**

Run:

```bash
git diff -- package.json package-lock.json prisma src/app/api src/lib
```

Expected: no output.

Run:

```bash
rg -n "Stripe|billing|payment card|paid API|OpenAI|Anthropic" src package.json
```

Expected: no new integration or billing configuration; existing truthful customer copy such as `No payment card` may appear.

- [ ] **Step 5: Commit metadata if it is not already included**

```bash
git add 'src/app/(app)/dashboard/page.tsx' 'src/app/(app)/procurement/page.tsx' 'src/app/(app)/procurement/new/page.tsx' 'src/app/(app)/menus/page.tsx' 'src/app/(app)/suppliers/page.tsx' 'src/app/(app)/insights/page.tsx' 'src/app/(app)/history/page.tsx' 'src/app/(app)/settings/page.tsx'
git commit -m "chore: align workspace page titles"
```

- [ ] **Step 6: Push the verified main branch**

```bash
git push origin main
```

Expected: `main` and `origin/main` point to the same final commit.
