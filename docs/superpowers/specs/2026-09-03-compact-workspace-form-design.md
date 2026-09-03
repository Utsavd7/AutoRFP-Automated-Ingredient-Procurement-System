# Compact Workspace Form Design

## Goal

Make the QuotePlate workspace creation page feel balanced and complete on a normal 1440 by 900 laptop screen. Reduce the oversized left headline, use the right sheet width more efficiently, and shorten the form without removing fields, hiding information, or changing registration behaviour.

## Scope

The form refinement applies only to the `/start` workspace creation experience. A related navigation refinement pins the existing headers on the public home page, `/product`, and `/start` at tablet and laptop widths. The `/signin` and legal-page layouts, authentication requests, validation rules, field names, Google flow, email flow, pilot limits, legal text, and mobile behaviour remain unchanged.

## Desktop composition

At widths of at least 1180 pixels and heights of at least 820 pixels, the page uses a calmer asymmetric split. The left context column becomes narrower, its headline is capped below the public landing hero scale, and the gap between context and form is reduced. The registration sheet receives the larger share of the 76rem page measure.

The full registration sheet, including the terms text and both sign-up buttons, must fit within a 1440 by 900 viewport without internal scrolling or clipped content. The page keeps natural document scrolling at shorter heights and narrower widths rather than compressing controls below comfortable sizes.

## Form arrangement

The start form remains one visible document. Related fields form clear two-column rows on desktop:

1. Restaurant name and restaurant phone
2. Street address across the full row
3. City and state
4. PIN code and optional GSTIN
5. Owner name and work email
6. Password across the full row

The field order in the document and keyboard sequence follows this visual order. Inputs retain at least a 44 pixel interactive height. The restaurant and owner fieldsets remain visibly labelled.

Email registration and Google registration sit side by side in one action row with a small “or” separator. On narrower screens they return to the existing stacked button layout. Error, progress, provider availability, account switching, and legal messages keep their current behaviour and remain readable below the actions.

## Vertical density

The pilot terms become a compact horizontal notice with the same three facts. Form and fieldset padding, row gaps, and introductory spacing reduce only within the height-qualified desktop layout. No content is removed and body text does not shrink below the existing readable size.

## Pinned navigation

At widths above 760 pixels, the existing headers on the public home page, guided product page, and workspace creation page remain pinned to the top of the viewport while the page scrolls. Use CSS sticky positioning so each header keeps its place in normal document flow and never covers the page content. The header retains its opaque stone background, bottom rule, current navigation, and accessible focus order.

The shared public header receives an explicit sticky variant used only by the home and product routes, so privacy and terms pages remain unchanged. The account header receives the same treatment only when the page is in workspace creation mode. Do not add scroll listeners, transparency effects, blur, shrinking behaviour, or animation.

## Responsive behaviour

- At 1440 by 900, the complete start form and both actions are visible without vertical or horizontal clipping.
- At desktop widths below 1180 pixels or heights below 820 pixels, the page uses its current natural-height layout.
- At 760 pixels and below, form fields and actions stack in one column.
- Above 760 pixels, the home, product, and start headers remain pinned while scrolling.
- At 760 pixels and below, every header keeps its current normal scrolling behaviour.
- At 480 pixels and below, the existing compact phone treatment remains authoritative.

## Accessibility and performance

The change uses the existing components, HTML controls, and CSS only. Labels, legends, focus states, validation messages, tab order, reduced motion, and minimum touch sizes remain intact. No package, image, client state, network request, database field, API, billing system, or external service is added.

## Verification

Add a real-browser contract for the start page at 1440 by 900 that confirms the sheet and all form controls fit within the viewport, fields occupy the approved desktop columns, both action buttons share one row, and no page overflow occurs. Confirm the 1024 by 650 and phone layouts retain natural document height and stacked actions. Verify that the home, product, and start headers remain at the viewport top after scrolling at tablet and laptop widths, while phone headers move with the document. Run the existing authentication journey, unit tests, TypeScript, lint, production build, and responsive browser tests before merging.
