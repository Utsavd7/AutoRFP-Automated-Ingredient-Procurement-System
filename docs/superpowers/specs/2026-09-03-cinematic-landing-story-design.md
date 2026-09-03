# QuotePlate Cinematic Landing Story

## Objective

Replace the current information heavy home page with a fast visual story that explains QuotePlate to an Indian restaurant owner, manager, chef, or purchasing employee without requiring procurement knowledge. The story must feel current in 2026 while preserving the established QuotePlate mark, colors, product truth, accessibility, and static rendering.

## Design Direction

The landing page behaves like one continuous restaurant buying journey. A copper route runs through the page and connects a menu, an ingredient request, chosen suppliers, returned quotes, a human decision, and saved history. Each scene combines a short sentence, a purpose built SVG symbol, and a truthful product representation. The visual language is operational rather than decorative: docket labels, table structure, clear arrows, and the existing ledger mark.

The existing dark green, copper, and stone palette remains the brand authority. The current logo and wordmark are reused unchanged. Newsreader remains reserved for selective brand emphasis while Manrope carries instructions and operational copy. Headings must not use letter spacing tighter than `-0.04em`.

## Page Story

### 1. Immediate promise

The first viewport states the product in plain English:

> Send one list. Compare every supplier. Choose the best deal.

Supporting text explains that the restaurant can use existing suppliers, compare price, GST, delivery, missing items, freight, and payment terms, and make the final choice. The primary action opens the product tour and the secondary action starts the free pilot. The no card and no supplier commission boundaries stay visible.

The main visual is a compact buying journey rather than a decorative hero image: a menu sheet becomes an ingredient request, reaches several suppliers, and returns as a comparison. It uses the same sample data already defined in `src/data/sample-procurement.ts`.

### 2. Add what the kitchen needs

Show three intake routes with custom symbols:

- photograph or scan a menu;
- upload existing menu photos;
- type dishes or ingredients directly.

An illustrative transition shows familiar dishes becoming a reviewable list of ingredients. It must not claim automatic accuracy or hide the required human review.

### 3. Choose suppliers

Explain that a restaurant can select existing suppliers, assign preferred suppliers to particular categories, and remain open to verified new supplier applications. Use examples familiar to Indian restaurant operations: vegetables, fruits, dairy, dry goods, beverages, coffee and tea, sweets, packaged foods, and outsourced snacks.

### 4. Send one request

Show one request branching to selected suppliers. Copy must state that every supplier receives the same itemised request through a private link and does not need a QuotePlate account.

### 5. Compare complete quotes

Use a real product style comparison with realistic rupee amounts and explicit sample labels. Surface landed total, item coverage, GST, freight, delivery, substitutions, and payment terms. The lowest number may be highlighted for scanning, but the page must never imply that QuotePlate automatically selects a winner.

### 6. Decide and reuse

Show a restaurant employee recording the chosen supplier, followed by the request entering saved history. Explain the recurring value plainly: even when a restaurant already knows a supplier, QuotePlate keeps price changes, previous orders, approvals, and supplier performance together for the next buying cycle.

### 7. Make privacy visible

Use a simple three party visibility diagram:

- the restaurant team sees its menus, recipes, suppliers, quotes, and buying history;
- each supplier sees only the request sent to that supplier;
- other restaurants see none of the restaurant's information.

The leading sentence is: “Your recipes stay private with your restaurant.” Supporting copy may explain expiring supplier links and recorded decisions, but must not claim certifications that the product does not hold.

### 8. One real purchase

Close with a restrained call to action:

> Try QuotePlate with one real purchase.

Keep “Start free pilot” and “See the product” as the two choices. State the controlled pilot limit and no card requirement without turning free tier mechanics into the main brand message.

## Visual Symbols

Create a small local SVG symbol set for the landing story. Symbols represent menu photo, dish, ingredient list, supplier, private link, rupee quote, GST, delivery, comparison, human approval, saved history, and privacy. They use a consistent 24 or 32 unit view box, round or square line treatment chosen once, `currentColor`, and accessible text supplied by the surrounding section.

These symbols are supporting illustrations, not alternate company logos. The QuotePlate ledger mark remains the only brand logo. Do not add stock icon tiles, oversized rounded icon containers, emoji, external icon APIs, or raster art for concepts that SVG can communicate more clearly.

## Motion

Use a small client component only where scroll progress materially improves the story. Prefer CSS sticky positioning, transforms, opacity, clip paths, and a single request animation. Do not add GSAP or another dependency.

The page must render complete content before JavaScript runs. Motion enhances an already visible layout and never controls access to information. `prefers-reduced-motion` removes the progress animation and presents the same scenes as a static sequence. Mobile uses a normal vertical flow with no scroll trapping or long sticky sections.

## Architecture

Keep the public home route static and free of authentication or database access. Split the landing page only into focused presentational components:

- `LandingJourney` owns the ordered story and route line;
- `JourneySymbol` owns the local SVG symbol vocabulary;
- existing `ProductDecisionPreview` remains the truthful quote comparison representation;
- `PublicHeader`, `PublicFooter`, brand components, and sample procurement data remain authoritative.

Styles remain in the existing public style system unless a small colocated module materially improves isolation. No new production dependency, external API, image host, database field, route, or environment variable is required.

## Responsive Behaviour

- Desktop: connected scenes may use alternating or sticky compositions with one dominant idea per viewport.
- Tablet: reduce overlap and keep visuals beside or directly below their explanations.
- Phone: use a single vertical route, full width controls, readable tables or compact comparisons, and no horizontal document overflow.
- Touch targets remain at least 44 by 44 pixels.
- Headings must wrap without clipping from 320 pixels upward.

## Performance Boundaries

- Keep the home page statically rendered.
- Add no third party script, autoplay video, remote font, or animation package.
- Inline SVG symbols must be small and reusable.
- Avoid layout shift by giving product visuals stable dimensions.
- Animation uses compositor friendly properties and stops when reduced motion is requested.
- Existing product navigation and dashboard bundles must not grow because of the landing story.

## Copy Rules

- Use short English sentences and familiar restaurant words.
- Explain any unavoidable procurement term where it first appears.
- Prefer actions such as “send”, “compare”, “choose”, and “save”.
- Do not use AI claims, guaranteed savings, invented adoption numbers, marketplace language, or technical infrastructure details.
- Label all prices, suppliers, requests, and product records used for demonstration as sample or illustrative data.

## Failure and Fallback Behaviour

The landing page has no runtime data dependency. If JavaScript is unavailable, every scene, link, comparison, and privacy statement remains visible and usable. If motion is unsupported, the connected route becomes a static line. Links continue to use the existing product, sign in, start, privacy, and terms destinations.

## Verification

1. Update the public copy contract tests for the new promise, ordered journey, sample labels, control boundaries, and privacy wording.
2. Add structural tests ensuring the journey symbols are local SVG and the landing remains independent of APIs, authentication, and database code.
3. Verify TypeScript, lint, unit tests, and production build.
4. Check 320, 390, 768, 1024, and 1440 pixel layouts for clipping and understandable sequence.
5. Check keyboard navigation, visible focus, heading order, landmark names, contrast, reduced motion, and non JavaScript readability.
6. Confirm the landing redesign does not change application routes, database schema, environment variables, or billing behaviour.

## Scope Limits

This work redesigns the public home page and only the shared public elements needed to support it. It does not alter authentication, procurement logic, the database, supplier submission behaviour, paid services, billing, or the product dashboard.
