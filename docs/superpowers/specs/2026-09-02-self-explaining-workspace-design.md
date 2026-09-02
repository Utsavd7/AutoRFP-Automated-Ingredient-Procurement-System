# Self-explaining workspace design

## Goal

Make QuotePlate understandable on first use to an Indian restaurant owner, manager, or chef without training. Every main screen must answer three questions in plain English: what is this page, why would I use it, and what should I do next?

## Direction

Keep one shared workspace for owners and managers. Do not add role-specific modes, new routes, database fields, background services, packages, or animations. Preserve every working procurement flow and improve only the language, information order, and small guidance cues.

The interface remains calm, editorial, and professional. It uses short sentences, familiar restaurant terms, Indian currency and units, direct action labels, strong contrast, and the current responsive layout.

## Navigation language

The visible navigation will use task names while retaining the current URLs:

| Current label | New label |
| --- | --- |
| Overview | Home |
| Procurement | Buy ingredients |
| Menus | Menu and ingredients |
| Suppliers | Suppliers |
| Insights | Savings and prices |
| History | Past purchases |
| Settings | Restaurant settings |
| New request | Ask suppliers for prices |

Icons remain secondary to text. Mobile navigation uses the same labels as desktop.

## Page contract

Every main page will have:

1. A plain title naming the restaurant task.
2. One short sentence explaining the page outcome.
3. One visually clear primary action when an action is available.
4. An empty state that tells the user exactly how to begin.
5. Errors that state what happened, confirm whether saved records are safe, and offer the next action.

The dashboard begins with `What needs your attention today?`, shows the owner-level summary first, and keeps operational work and deadlines immediately below it. This serves both decision makers and daily operators without adding separate modes.

## Core page wording

- **Home:** See requests, quotes, menus, and supplier work that need attention today.
- **Buy ingredients:** Ask suppliers for prices, compare the final cost, and record who you choose.
- **Menu and ingredients:** Add dishes, check their ingredients, and prepare them for a buying request.
- **Suppliers:** Keep the suppliers you already use and what each one can supply in one place.
- **Savings and prices:** See supplier response, submitted price differences, and facts from previous buying.
- **Past purchases:** Find earlier requests and decisions, then repeat a purchase when needed.
- **Restaurant settings:** Update restaurant details, team access, and workspace preferences.

Procurement statuses will be explained in familiar terms such as `Not sent`, `Waiting for suppliers`, `Ready to compare`, and `Supplier selected`. Where the stored status name must remain unchanged, the interface will translate it without changing the underlying value.

Forms will replace internal terminology with customer language. Examples include `Payment and order terms` instead of `Commercial terms`, `Items you need` instead of `Demand`, and `Compare supplier prices` instead of `Fact comparison`. Existing validation and calculations remain unchanged.

## Privacy reassurance

The public security section and the signed-in workspace will state this promise clearly:

> Your recipes, menus, supplier prices, and purchase records stay private to your restaurant. Other restaurants cannot see them, and suppliers see only the request you send to them.

The message is a concise reassurance, not a legal claim that exceeds the existing access controls. It will appear where users decide whether to add menu and supplier information. The privacy notice remains the detailed source of truth.

## Guidance without clutter

- Advanced commercial and audit details remain available but do not lead the page.
- Short supporting text appears below unfamiliar headings or fields.
- Empty states use one primary next step rather than several competing choices.
- The existing optional setup guide adopts the same task labels and can still be skipped.
- Tooltips are not added for information that can be stated directly on the page.

## Accessibility and performance

The change must preserve semantic headings, keyboard navigation, focus behavior, accessible names, responsive layouts, and reduced-motion behavior. It must add no client request, external font, paid service, AI call, or database work. Copy changes must not delay navigation or increase the loading skeleton duration.

## Verification

- Update focused UI tests to assert the new navigation, page explanations, action labels, statuses, tutorial wording, and privacy promise.
- Run type checking, linting, and the relevant UI test suites.
- Run the production build.
- Check the source-level mobile navigation contract without opening Chrome.

## Out of scope

- Separate owner and manager modes.
- New permissions or workflow states.
- Database or API changes.
- Additional onboarding systems.
- Paid services, paid AI, billing, payments, or card storage.
