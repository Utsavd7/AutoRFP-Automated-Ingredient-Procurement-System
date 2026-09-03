# QuotePlate Cinematic Landing Story

## Objective

Replace the current information heavy home page with a fast visual story that explains QuotePlate to an Indian restaurant owner, manager, chef, or purchasing employee without requiring procurement knowledge. Keep the guided product page on the same measured visual rhythm. Both journeys must feel current in 2026 while preserving the established QuotePlate mark, colors, product truth, accessibility, and static rendering.

## Design Direction

The landing page behaves like one continuous restaurant buying journey. A copper route runs through the page and connects a menu, an ingredient request, chosen suppliers, returned quotes, a human decision, and saved history. Each scene combines a short sentence, one icon from the product's existing Lucide family, and a truthful product representation. The visual language is operational rather than decorative: docket labels, table structure, clear arrows, and the existing ledger mark.

The existing dark green, copper, and stone palette remains the brand authority. The current logo and wordmark are reused unchanged. Newsreader remains reserved for selective brand emphasis while Manrope carries instructions and operational copy. Headings must not use letter spacing tighter than `-0.04em`.

## Page Story

### 1. Immediate promise

The first viewport states the product in plain English:

> Send one list. Compare every supplier. Choose the best deal.

Supporting text explains that the restaurant can use existing suppliers, compare price, GST, delivery, missing items, freight, and payment terms, and make the final choice. The primary action opens the product tour and the secondary action starts the free pilot. The no card and no supplier commission boundaries stay visible.

The main visual is a compact buying journey rather than a decorative hero image: a menu sheet becomes an ingredient request, reaches several suppliers, and returns as a comparison. It uses the same sample data already defined in `src/data/sample-procurement.ts`. The current `ProductDecisionPreview` is a protected design element: keep its recognizable desktop window, dark restaurant sidebar, sample request summary, comparison table, human decision message, and sample data note.

On desktop screens at least 901 pixels wide and 720 pixels tall, the header and complete hero form one opening frame at normal browser zoom. The headline, explanation, actions, no card note, and buying journey diagram must all be visible before scrolling. The top border of the sample facts section sits at the bottom edge of the viewport, so scrolling begins visually from that line. Short desktop windows use natural document height rather than shrinking or clipping content. Tablet and phone layouts retain their existing vertical flow.

### 2. Add what the kitchen needs

Show three intake routes with consistent Lucide symbols:

- photograph or scan a menu;
- upload existing menu photos;
- type dishes or ingredients directly.

An illustrative transition shows familiar dishes becoming a reviewable list of ingredients. It must not claim automatic accuracy or hide the required human review.

### 3. Choose suppliers

Explain that a restaurant can select existing suppliers, assign preferred suppliers to particular categories, and remain open to verified new supplier applications. Use examples familiar to Indian restaurant operations: vegetables, fruits, dairy, dry goods, beverages, coffee and tea, sweets, packaged foods, and outsourced snacks.

### 4. Send one request

Show one request branching to selected suppliers. Copy must state that every supplier receives the same itemised request through a private link and does not need a QuotePlate account.

### 5. Compare complete quotes

Use the existing `ProductDecisionPreview` as the visual centre of this scene rather than replacing or restyling it into a new concept. Preserve its current hierarchy and visual character while improving only the sizing, responsive fit, and connection to the surrounding story. Its realistic rupee amounts and explicit sample labels remain. Supporting details may surface GST, freight, delivery, substitutions, and payment terms. The lowest number may be highlighted for scanning, but the page must never imply that QuotePlate automatically selects a winner.

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

## Icons and Diagrams

Use the open source Lucide icon family already installed and used by QuotePlate. Select icons for menu photo, upload, ingredient list, supplier, private link, rupee quote, GST receipt, delivery, comparison, human approval, saved history, and privacy. Use one shared wrapper to enforce the same size, stroke width, alignment, and `currentColor` behaviour everywhere. Accessible names come from the surrounding section, so decorative icons stay hidden from assistive technology.

Polished interface-style SVG diagrams are allowed when they follow the same grid, palette, typography, line weight, and realistic data treatment as `ProductDecisionPreview`. They may show requests moving between a restaurant and suppliers or a menu becoming an ingredient list, but they must read as QuotePlate product diagrams rather than hand-drawn artwork. The QuotePlate ledger mark and wordmark remain the only company logos and use their existing committed vector components without redrawing. Small symbols come from Lucide. Do not add inconsistent custom icon sets, stock icon tiles, oversized rounded icon containers, emoji, external icon APIs, or decorative raster art.

## Motion

Motion guides the eye through the same operational sequence shown by the diagrams. The hero nodes settle in from left to right and its connectors travel once on page load. As the user scrolls, the intake choices, supplier categories, request branches, quote comparison, decision route, and privacy rows receive a small rise or line reveal when they enter the viewport. The movement stays within roughly 16 pixels, does not loop, and never competes with reading.

Use CSS view timelines as a progressive enhancement rather than adding a client component, GSAP, Three.js, or another dependency. Browsers without scroll timeline support show the complete static diagrams. Do not animate layout properties, trap scrolling, add a continuous floating effect, or delay navigation.

The page must render complete content before JavaScript runs. Motion enhances an already visible layout and never controls access to information. `prefers-reduced-motion` removes the progress animation and presents the same scenes as a static sequence. Mobile uses a normal vertical flow with no scroll trapping or long sticky sections.

## Architecture

Keep the public home route static and free of authentication or database access. Split the landing page only into focused presentational components:

- `LandingJourney` owns the ordered story and route line;
- `JourneyIcon` applies consistent presentation to icons imported from the existing Lucide dependency;
- existing `ProductDecisionPreview` remains the truthful quote comparison representation;
- `PublicHeader`, `PublicFooter`, brand components, and sample procurement data remain authoritative.

Styles remain in the existing public style system unless a small colocated module materially improves isolation. No new production dependency, external API, image host, database field, route, or environment variable is required.

## Responsive Behaviour

- Desktop: connected scenes use one dominant, vertically centred idea per viewport without sticky copy or scroll trapping.
- Tablet: reduce overlap and keep visuals beside or directly below their explanations.
- Phone: use a single vertical route, full width controls, readable tables or compact comparisons, and no horizontal document overflow.
- Touch targets remain at least 44 by 44 pixels.
- Headings must wrap without clipping from 320 pixels upward.

### Desktop story scale

At normal browser zoom, the sections after the hero use the same measured visual proportions as the approved opening frame. This applies to both the home page buying journey and the guided product page. On desktop screens at least 901 pixels wide and 720 pixels tall, the home story introduction, each of its five operational scenes, the privacy section, each guided product tour step, and the product principles section each occupy at least one viewport height. Their contents remain vertically centred inside that frame, without scroll snapping, sticky text, or trapped scrolling.

The lower sections match their page hero's balance rather than copying its headline size literally. Step headings remain subordinate to the main promise, body copy stays at the existing readable size, and each operational diagram receives the larger share of the two-column frame. Both journeys use the same 76rem content measure as their headers so copy and visuals align while scrolling. Comparison scenes may retain wider visual columns because their tables need more horizontal room. Existing product workspace mockups keep their internal type scale and structure.

Desktop typography and spacing must respond to viewport height as well as width. At the 720 pixel height boundary, every section must fit without clipping or horizontal overflow. Desktop windows shorter than 720 pixels fall back to natural content height. Tablet and phone layouts retain their existing stacked flow, typography, spacing, and touch targets.

This refinement changes only public-page styles and their browser contract. It does not rewrite copy, replace diagrams, add scroll snapping, strengthen motion, add dependencies, or alter product behaviour. The closing calls to action and footers remain natural-height endings rather than becoming additional full-screen scenes.

## Performance Boundaries

- Keep the home page statically rendered.
- Add no third party script, autoplay video, remote font, or animation package.
- Lucide icons must be imported individually and rendered through the shared wrapper.
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
2. Add structural tests ensuring the landing uses the existing icon dependency, preserves the committed QuotePlate logo components, and remains independent of APIs, authentication, and database code.
3. Verify TypeScript, lint, unit tests, and production build.
4. Check 320, 390, 768, 1024, and 1440 pixel layouts for clipping and understandable sequence.
5. At 1440 by 960, 1366 by 768, and 1024 by 900, confirm the sample facts border begins at the viewport fold and every hero element is visible without scrolling. Confirm short desktop windows fall back to natural page height.
6. Check that supported browsers apply scroll linked motion to the landing diagrams, unsupported browsers retain the static content, and reduced motion removes all landing animation and transforms.
7. Check keyboard navigation, visible focus, heading order, landmark names, contrast, reduced motion, and non JavaScript readability.
8. Confirm the landing redesign does not change application routes, database schema, environment variables, or billing behaviour.
9. Confirm every desktop home-story and guided-product scene reaches at least one viewport height at the 901 by 720 boundary and common laptop sizes, while shorter desktops and all tablet and phone sizes keep natural document height.

## Scope Limits

This work refines the public home page and guided product page, plus only the shared public styles needed to support them. It does not alter authentication, procurement logic, the database, supplier submission behaviour, paid services, billing, or the product dashboard.
