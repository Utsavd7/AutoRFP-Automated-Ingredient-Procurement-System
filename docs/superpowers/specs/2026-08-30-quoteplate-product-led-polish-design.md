# QuotePlate product-led polish design

**Status:** Approved direction, ready for implementation  
**Date:** 2026-08-30  
**Direction:** A1 — Product-led ledger

## Goal

Make QuotePlate feel like an established, launch-ready restaurant procurement company while keeping the product fast, clear, credible, and inexpensive to operate. The public website must explain the value within seconds and show a believable purchasing decision immediately. The signed-in product must feel like the same brand without sacrificing daily usability.

## Product and audience

QuotePlate helps independent restaurants and small restaurant groups in India send ingredient requests to their existing suppliers, compare complete commercial terms, and keep a factual record of the final award.

The primary visitor is a restaurant owner, purchasing manager, chef-owner, or operations lead. Copy must use plain English, avoid procurement jargon where possible, and remain understandable to people who are not highly technical or formally trained.

## Design decision

Use the approved **A1 Product-led ledger** direction:

- warm stone background, deep ink surfaces, copper emphasis, and success green;
- Newsreader for editorial authority and Manrope for practical interface text;
- an asymmetric hero with clear language on the left and a real-looking QuotePlate comparison workspace on the right;
- restrained physical texture and nested product framing instead of gradients or stock imagery;
- useful live signals—supplier replies, requests ready for review, and realistic INR totals—rather than decorative animation;
- compact, deliberate controls with square-to-soft corners; pills only for statuses and compact metadata;
- the existing two-part QuotePlate mark and wordmark remain the brand authority.

The design must not imitate Linear, Ramp, Attio, or Rillet. Their useful patterns are limited to immediate product proof, concise claims, live operational evidence, asymmetric composition, and restrained motion. Restaurant competitors currently leave room for QuotePlate to be clearer and more product-led.

## Public homepage hierarchy

### 1. Header

Preserve the current public header as the baseline: the existing wordmark scale and spacing on the left, `Product`, `How it works`, and `Security` centred, then `Sign in` and the dark `Start a pilot` button on the right. Keep its calm stone background, generous horizontal spacing, thin lower rule, and current height. Do not add a floating pill container or an announcement strip above it.

### 2. Product-led hero

Approved message:

> Compare every quote. Choose with proof.

Supporting copy explains the complete flow in plain English: send one ingredient request to existing suppliers, compare price, delivery, and terms, then record the human decision.

The primary action opens the product tour. The secondary action starts onboarding. A short note states: no marketplace, no supplier commission, no card required.

### 3. Sample decision preview

Replace the oversized decorative logo panel with a high-fidelity, responsive HTML product preview. Every value must render from the existing `restaurantSampleRequest` and `restaurantSampleQuotes` exports in `src/data/sample-procurement.ts`; components must not introduce a second set of hard-coded sample facts. It shows:

- request `QP-1042`, a seven-day kitchen order in Indiranagar, Bengaluru;
- eight requested items and three received supplier quotes;
- the three supplier totals, coverage, delivery, and terms from the shared sample dataset;
- delivery and payment terms;
- a `Review & award` link to the comparison section of the public product tour;
- a small supplier-response signal that uses subtle transform/opacity motion.

The preview is illustrative and must not imply customer activity or live market prices. `Sample data` and `Illustrative prices · not live market data` remain visible without interaction. The homepage and product tour remain static server-rendered UI with CSS-only motion: no polling, API calls, WebSocket, client state, or new runtime dependency.

### 4. Operating signals

Directly under the hero, show a narrow evidence band describing only the displayed sample: `3 supplier replies`, `8 items requested`, `1 decision waiting for review`, and `Human approval required`. Do not present these figures as customer usage, production telemetry, customer savings, or customer counts.

### 5. Why teams keep using it

Explain the durable value that prevents QuotePlate becoming a one-time supplier-discovery tool:

- the restaurant brings its own supplier relationships;
- repeat requests take less work because item requirements and suppliers are already saved;
- current quotes can be compared with previous awards and price history;
- choosing one supplier—or dividing items between suppliers—remains tied to the facts used to decide;
- the supplier does not need an account.

This section should show one continuous request → quote → decision record, not a generic feature-card grid.

### 6. Security and control

Keep the dark ink section. Use plain public language: each restaurant can only see its own records; private supplier links expire; the restaurant team makes the final choice; and quote changes and decisions stay recorded. Avoid unverifiable security badges, certifications, or enterprise claims. Technical labels may remain inside the signed-in product where operationally necessary.

### 7. Final pilot action and footer

Use one clear pilot CTA. State: `Controlled free pilot for up to four restaurant workspaces. Approved Google account required. No card.` The `/start` experience must explain the approval requirement before form submission. The footer retains product, privacy, terms, sign-in, and onboarding links.

## Product tour

The public product page must use the same product-led visual language. Preserve the four real workflows—review demand, issue request, supplier response, and award—but tighten their presentation and reuse the improved comparison surface. Avoid fictional feature breadth.

## Signed-in product

The current information architecture and functionality remain unchanged. This pass is strictly limited to `PublicLandingPage`, `ProductTour`, `SampleQuoteComparison`, the existing public/auth/app-shell styles, `AuthPageShell`, `AppLayout`, and `OverviewWorkspace`. Workflow pages receive inherited colour, font, focus, and shell tokens only; they receive no layout or component rewrite. Add no design-system package and no abstraction used by fewer than two touched surfaces.

Polish the shared shell and overview so the application feels continuous with the public brand:

- preserve the left navigation on laptops and the existing mobile drawer;
- use a calmer nested surface for the sidebar and main workspace;
- make the restaurant identity—name and city/state—the new-request action, and the account area clearer;
- improve hierarchy and spacing without increasing component count;
- keep dense tables and operational lists readable—do not turn the application into a marketing page;
- use copper for attention and green for successful/completed states, never as broad decorative fills;
- preserve existing focus, hover, press, empty, loading, and error behaviour while aligning the touched surfaces visually.

Do not add a location selector, outlet switcher, or implied multi-outlet state.

## Responsive behaviour

- **Large laptop/desktop (1440×960):** asymmetric split hero; product preview is fully visible without page-level horizontal scrolling.
- **Tablet (iPad Pro 11):** use the existing 900px public breakpoint and place the product preview below the headline when the split is no longer legible.
- **Phone (iPhone 13):** use the existing 620px public breakpoint, a single-column hero, full-width actions, horizontally scrollable comparison details with an explicit hint, 44px minimum touch targets, and no overlapping decorative layers.
- **Signed-in shell:** preserve the existing 1024px drawer breakpoint.
- No page-level horizontal overflow is allowed; only the labelled comparison region may scroll horizontally.
- Never use a fixed `100vh` hero on mobile.

## Motion and interaction

- Use only CSS already available in the project; add no animation library.
- Motion must explain state: a supplier reply arriving, a status becoming ready, or a section entering view.
- Animate only `transform` and `opacity`, use custom easing, and keep durations restrained.
- Honour `prefers-reduced-motion` and remove non-essential movement.
- Do not reproduce third-party animation repositories or Apple animation clones.

## Accessibility and performance

- Preserve semantic headings, landmarks, skip navigation, visible focus, keyboard access, and sufficient colour contrast.
- Product-preview text that communicates value must remain readable or have a concise accessible alternative.
- No remote hero image, video dependency, WebGL, paid API, analytics SDK, or new runtime dependency.
- Keep the existing locally hosted fonts and brand SVGs.
- Avoid broad blur effects and large repaint-heavy filters.

## Commercial and infrastructure constraints

- No billing UI, Stripe code, card collection, paid API, marketplace fee, or automatic upgrade path.
- Copy may state `Free pilot for up to four restaurants` and `No card required`.
- Hosting and database remain on manually controlled free tiers; scale must fail safely rather than start paid billing.
- This redesign changes no database table or column.

## Validation

Before shipping:

1. Run formatting/lint, type checking, unit/integration tests, and the production build.
2. Verify the homepage, product tour, sign-in, onboarding, overview, and mobile navigation at phone, tablet, and laptop widths.
3. Confirm all primary actions reach the correct pages and no fictional customer proof is introduced.
4. Confirm reduced-motion behaviour, keyboard focus, horizontal table scrolling, and contrast.
5. Deploy to a preview, inspect visually, then merge and verify production readiness.

## Out of scope

- new procurement features or schema changes;
- a full marketing CMS;
- testimonials or customer logos before real permission exists;
- paid messaging, generative AI, stock-media subscriptions, or analytics products;
- animations added only for spectacle.
