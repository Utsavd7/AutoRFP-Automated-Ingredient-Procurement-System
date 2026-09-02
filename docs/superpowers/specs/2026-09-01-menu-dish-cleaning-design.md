# Menu dish cleaning and deletion design

## Goals

Turn text read from menu photos into an editable list containing dish names only. Remove obvious prices and non-menu noise without deleting legitimate names such as `Chicken 65`.

Let a user select and remove several dishes from a draft at once, and permanently delete a whole menu when doing so cannot damage procurement history.

## Cost boundary

The cleaner runs entirely in the browser with deterministic TypeScript rules after the existing bundled Tesseract OCR step. It adds no API, hosted model, subscription, paid service, dependency, database table, or database column. Running it costs ₹0 beyond the application's existing hosting.

## Scope

The change applies only to text recognized from uploaded or phone-captured menu photos. Typed, pasted, and permitted website menu text keep their current behaviour.

The cleaner will:

- remove list markers and item numbers from the start of a line;
- remove trailing prices written with `₹`, `Rs`, `INR`, `/-`, decimals, or common half and full price layouts;
- remove lines that are only prices, separators, menu headings, category headings, contact details, addresses, tax text, opening hours, ordering instructions, or short description labels;
- remove obvious description lines beginning with phrases such as `served with`, `made with`, or `choice of`;
- remove duplicate dish names while preserving the first occurrence and OCR order;
- preserve meaningful numbers in dish names, including `Chicken 65`, `Gobi 65`, and names such as `2 in 1 Dosa`;
- keep uncertain lines rather than risk silently deleting a real dish;
- show the result in the existing editable review box before the user saves it.

The menu editor will also:

- show an accessible checkbox for every dish;
- provide `Select all`, `Clear selection`, and `Remove selected` actions;
- ask for confirmation before removing selected dishes;
- reindex remaining dishes in their existing order;
- keep removals in the editable draft until the user saves;
- provide a separate `Delete menu` action with a clear permanent-deletion confirmation;
- delete a menu only when no procurement request refers to it;
- explain that a used menu must remain because it forms part of procurement history.

## Design

A small pure function in the existing menu photo intake module will accept recognized OCR lines and return cleaned lines. Each retained line keeps its original confidence value. The browser OCR module will pass its recognized lines through this function once, after all selected photos have been read and before producing preview text.

The rules remain ordered and conservative:

1. Normalize spacing and remove list markers.
2. Reject lines that match strong non-dish signals.
3. Remove strong trailing price patterns.
4. Reject any line left empty or without letters.
5. Deduplicate case-insensitively while preserving order.

No probabilistic classification, network request, menu dictionary, or background job is introduced.

Dish selection remains local component state. The existing draft update saves the resulting document, so multi-select removal requires no new API or data model.

Whole-menu deletion adds `DELETE` to the existing menu detail endpoint and a matching tenant-scoped service operation. The request carries the menu version so a stale screen cannot delete a menu that changed after it was opened. The service checks for linked procurement requests before deleting, and the existing database restriction remains a final safety boundary.

## Error handling

If cleaning removes every recognized line, the existing empty-result message asks the user for a clearer photo or manual dish entry. Uncertain text stays editable so the restaurant owner can correct it before saving.

Removing no selected dishes does nothing. Deleting a missing, changed, cross-tenant, or historically used menu returns the existing private error format. A successful whole-menu deletion returns the user to the menu list and clears the workspace cache.

## Verification

Focused unit tests will be written before implementation and must first fail for the missing behavior. They will cover:

- rupee, `Rs`, `INR`, decimal, and `/-` prices;
- half and full prices;
- serial numbers and bullets;
- category, contact, GST, hours, and description noise;
- duplicate dishes;
- numbered dish names;
- confidence alignment and original order;
- the all-noise result.

Menu editor and deletion tests will cover:

- selecting one, several, and all dishes;
- removing selected dishes and preserving order;
- menu deletion confirmation and successful navigation;
- tenant isolation and version conflicts;
- blocking deletion when a procurement request uses the menu;
- successful deletion of an unused draft or approved menu;
- cross-origin, unauthenticated, and unexpected-failure responses.

After the focused tests pass, the existing unit suite, type check, lint, and production build must also pass.
