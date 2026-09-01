# Menu Cleaning and Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn menu-photo OCR into an editable dish-name list, add multi-select dish removal, and let users permanently delete menus that are not part of procurement history.

**Architecture:** Keep OCR cleaning as one deterministic browser-side function between Tesseract output and the existing review field. Keep dish selection entirely inside `MenuEditor`, persist it through the existing menu update, and add one tenant-scoped optimistic `DELETE` operation to the existing menu endpoint without changing the schema.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma 5, Jest 30, existing Tesseract.js 7 assets, existing CSS Modules.

---

## Boundaries

- No database migration, new table, new column, package, hosted model, paid API, or billing integration.
- Apply cleaning only to text returned by menu-photo OCR. Do not alter typed, pasted, or website-imported menu text.
- Preserve uncertain lines for human review. Prefer a false negative over silently deleting a real dish.
- Keep the database relation restriction intact and block deletion when any procurement request refers to the menu.
- Reuse the existing private response, mutation security, tenant transaction, audit, and workspace cache invalidation paths.

### Task 1: Specify the dish-name cleaner with failing tests

**Files:**
- Modify: `__tests__/menu/photo-intake.test.ts`
- Test: `__tests__/menu/photo-intake.test.ts`

- [ ] **Step 1: Import the missing cleaner and add the representative Indian-menu test**

```ts
import {
  cleanRecognizedMenuLines,
  // existing imports
} from '@/lib/menu/photo-intake';

it('keeps dish names while removing OCR prices, headings, descriptions, and duplicates', () => {
  expect(cleanRecognizedMenuLines([
    { text: '1. Paneer Tikka ₹260', confidence: 0.94 },
    { text: 'VEG STARTERS', confidence: 0.98 },
    { text: 'Chicken 65', confidence: 0.9 },
    { text: '2 in 1 Dosa 180/-', confidence: 0.84 },
    { text: 'Dal Makhani Half 180 Full 320', confidence: 0.8 },
    { text: 'Served with mint chutney', confidence: 0.7 },
    { text: 'Call 9876543210', confidence: 0.99 },
    { text: 'paneer tikka 260', confidence: 0.88 },
  ])).toEqual([
    { text: 'Paneer Tikka', confidence: 0.94 },
    { text: 'Chicken 65', confidence: 0.9 },
    { text: '2 in 1 Dosa', confidence: 0.84 },
    { text: 'Dal Makhani', confidence: 0.8 },
  ]);
});
```

- [ ] **Step 2: Add focused cases for supported price forms and all-noise input**

Cover `Rs 180`, `INR 180.00`, `₹180`, `180/-`, two-column half/full prices, bullets and serials, category headings, GST/tax, address/phone/hours/order text, duplicate casing, `Gobi 65`, and an input where every line is noise.

- [ ] **Step 3: Run the focused test and confirm it fails because the cleaner is missing**

Run: `npm test -- --runTestsByPath __tests__/menu/photo-intake.test.ts`

Expected: FAIL with `cleanRecognizedMenuLines` missing or not a function.

- [ ] **Step 4: Commit the red test**

```bash
git add __tests__/menu/photo-intake.test.ts
git commit -m "test: define menu photo dish cleaning"
```

### Task 2: Implement and connect the conservative OCR cleaner

**Files:**
- Modify: `src/lib/menu/photo-intake.ts`
- Modify: `src/lib/menu/browser-ocr.ts`
- Test: `__tests__/menu/photo-intake.test.ts`

- [ ] **Step 1: Add the recognized-line type and pure cleaner**

Add this public shape to `photo-intake.ts`:

```ts
export type RecognizedMenuLine = {
  text: string;
  confidence: number;
};

export function cleanRecognizedMenuLines(
  lines: readonly RecognizedMenuLine[],
): RecognizedMenuLine[] {
  const seen = new Set<string>();
  const cleaned: RecognizedMenuLine[] = [];

  for (const line of lines) {
    const text = cleanRecognizedMenuLine(line.text);
    if (!text || !/[A-Za-z]/.test(text)) continue;
    const key = text.toLocaleLowerCase('en-IN');
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ text, confidence: line.confidence });
  }
  return cleaned;
}
```

Keep the private rules ordered: normalize spaces and markers; reject strong whole-line noise; remove strong trailing price layouts; reject empty/no-letter results; deduplicate. Use explicit heading/contact/description patterns and guarded trailing-number rules so `Chicken 65`, `Gobi 65`, and `2 in 1 Dosa` survive.

- [ ] **Step 2: Pass Tesseract lines through the cleaner once**

In `browser-ocr.ts`, import the public type and function, remove the duplicate local line type, then replace the final mapping with:

```ts
const cleaned = cleanRecognizedMenuLines(recognized);
return {
  text: cleaned.map((line) => line.text).join('\n'),
  confidences: cleaned.map((line) => line.confidence),
};
```

- [ ] **Step 3: Run the focused test**

Run: `npm test -- --runTestsByPath __tests__/menu/photo-intake.test.ts`

Expected: PASS.

- [ ] **Step 4: Verify the cleaner is correctly connected to the browser OCR module**

Run: `npm run typecheck`

Expected: PASS. Do not add a mocked Tesseract worker test; the pure rule tests and this compile-time integration check cover this small connection without overtesting it.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/lib/menu/photo-intake.ts src/lib/menu/browser-ocr.ts __tests__/menu/photo-intake.test.ts
git commit -m "feat: clean menu photo text into dish names"
```

### Task 3: Specify safe whole-menu deletion with failing service tests

**Files:**
- Modify: `__tests__/menu/menu-service.test.ts`
- Test: `__tests__/menu/menu-service.test.ts`

- [ ] **Step 1: Import `deleteReviewedMenu` and add the successful unused-menu case**

Build a transaction mock with `menu.findFirst`, `procurementRequest.count`, `menu.deleteMany`, and `auditEvent.create`. Assert that deletion is tenant scoped, version scoped, returns `{ id: 'menu-a' }`, and writes `menu.deleted` with the deleted version.

- [ ] **Step 2: Add the history, stale-version, and cross-tenant cases**

```ts
await expect(deleteReviewedMenu({
  actor,
  menuId: 'menu-a',
  expectedVersion: 1,
}, client as never)).rejects.toMatchObject({
  code: 'MENU_CONFLICT',
  message: 'This menu has procurement history and cannot be deleted.',
});
```

Also assert that a stale version never calls `deleteMany`, and a menu not returned by the tenant-scoped lookup raises `MenuNotFoundError`.

- [ ] **Step 3: Run the service test and confirm the missing export fails**

Run: `npm test -- --runTestsByPath __tests__/menu/menu-service.test.ts`

Expected: FAIL because `deleteReviewedMenu` does not exist.

- [ ] **Step 4: Commit the red test**

```bash
git add __tests__/menu/menu-service.test.ts
git commit -m "test: define safe menu deletion"
```

### Task 4: Implement tenant-scoped optimistic menu deletion

**Files:**
- Modify: `src/lib/menu/menu-service.ts`
- Modify: `src/lib/audit/write-event.ts`
- Test: `__tests__/menu/menu-service.test.ts`

- [ ] **Step 1: Allow the bounded deletion audit event**

Add this rule beside `menu.approved`:

```ts
'menu.deleted': { entityType: 'Menu', metadata: ['version'] },
```

- [ ] **Step 2: Add the service operation using existing validation and transaction helpers**

```ts
export async function deleteReviewedMenu(
  input: { actor: MenuActor; menuId: string; expectedVersion: unknown },
  client: MenuClient = prisma,
) {
  const actor = validateActor(input.actor);
  const menuId = validateMenuId(input.menuId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);

  return withTenant(actor.tenantId, async (transaction) => {
    const existing = await transaction.menu.findFirst({
      where: { tenantId: actor.tenantId, id: menuId },
      select: { id: true, version: true },
    });
    if (!existing) throw new MenuNotFoundError();
    if (existing.version !== expectedVersion) {
      throw new MenuConflictError(
        'This menu changed after you opened it. Reload before continuing.',
      );
    }
    const requestCount = await transaction.procurementRequest.count({
      where: { tenantId: actor.tenantId, menuId },
    });
    if (requestCount > 0) {
      throw new MenuConflictError(
        'This menu has procurement history and cannot be deleted.',
      );
    }
    const deleted = await transaction.menu.deleteMany({
      where: { tenantId: actor.tenantId, id: menuId, version: expectedVersion },
    });
    if (deleted.count !== 1) {
      throw new MenuConflictError(
        'This menu changed after you opened it. Reload before continuing.',
      );
    }
    await writeAuditEvent(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'menu.deleted',
      entityId: menuId,
      metadata: { version: expectedVersion },
    });
    return { id: menuId };
  }, client);
}
```

- [ ] **Step 3: Run the focused service test**

Run: `npm test -- --runTestsByPath __tests__/menu/menu-service.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit the service implementation**

```bash
git add src/lib/menu/menu-service.ts src/lib/audit/write-event.ts __tests__/menu/menu-service.test.ts
git commit -m "feat: safely delete unused menus"
```

### Task 5: Add the private DELETE endpoint test first, then implementation

**Files:**
- Modify: `__tests__/api/menus.test.ts`
- Modify: `src/app/api/menus/[id]/route.ts`
- Test: `__tests__/api/menus.test.ts`

- [ ] **Step 1: Extend the API mocks and add a failing successful-delete test**

Import `DELETE as deleteMenu`, mock `deleteReviewedMenu`, send `{ expectedVersion: 2 }`, and assert:

```ts
expect(deleteReviewedMenu).toHaveBeenCalledWith({
  actor: { tenantId: 'tenant-a', userId: 'member-a' },
  menuId: 'menu-a',
  expectedVersion: 2,
});
expect(response.status).toBe(200);
await expect(response.json()).resolves.toEqual({ deletedMenuId: 'menu-a' });
```

- [ ] **Step 2: Add deletion to the existing private-response, safe-error, unexpected-error, and cross-origin tables**

Assert 409 for a history conflict, 401 without an account, 403 before authentication for a cross-origin request, 415 without JSON, and a generic private 500 for an unexpected exception.

- [ ] **Step 3: Run the API test and confirm the missing route fails**

Run: `npm test -- --runTestsByPath __tests__/api/menus.test.ts`

Expected: FAIL because `DELETE` and `deleteReviewedMenu` are missing.

- [ ] **Step 4: Implement `DELETE` beside `PUT`**

Reuse `browserJsonMutationRejection`, `requireAccountContext`, `readBoundedJson`, `expectedVersionFrom`, `menuError`, and `privateMutationResponse`. The success body is:

```ts
const deleted = await deleteReviewedMenu({
  actor: actorFrom(account),
  menuId: id,
  expectedVersion: expectedVersionFrom(body),
});
return privateMutationResponse(
  NextResponse.json({ deletedMenuId: deleted.id }),
);
```

- [ ] **Step 5: Run the focused API test**

Run: `npm test -- --runTestsByPath __tests__/api/menus.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit endpoint and tests**

```bash
git add src/app/api/menus/[id]/route.ts __tests__/api/menus.test.ts
git commit -m "feat: expose private menu deletion"
```

### Task 6: Add multi-select and whole-menu deletion to the editor

**Files:**
- Modify: `__tests__/ui/menu-editor.test.tsx`
- Modify: `src/components/menus/MenuEditor.tsx`
- Modify: `src/components/menus/menu-editor.module.css`
- Test: `__tests__/ui/menu-editor.test.tsx`

- [ ] **Step 1: Add a failing pure-helper test for selected dish removal**

Export and test:

```ts
export function removeSelectedDishes(
  dishes: Readonly<MenuDocumentV1['dishes']>,
  selectedIds: ReadonlySet<string>,
): MenuDocumentV1['dishes'] {
  return dishes
    .filter(({ id }) => !selectedIds.has(id))
    .map((dish, position) => ({ ...dish, position }));
}
```

Use three dishes, remove the first and third, and assert the surviving dish has `position: 0` and otherwise unchanged data.

- [ ] **Step 2: Extend the static markup test with the required controls**

Assert the rendered editor contains `Select all`, `Remove selected`, `Delete menu`, and an accessible dish-selection label containing the dish name.

- [ ] **Step 3: Run the UI test and confirm the missing helper and controls fail**

Run: `npm test -- --runTestsByPath __tests__/ui/menu-editor.test.tsx`

Expected: FAIL.

- [ ] **Step 4: Implement local selection state and batch removal**

Add `selectedDishIds` and `deleting` state. Selection uses dish IDs, `Select all` derives from the current dishes, `Clear selection` empties the set, and `Remove selected` confirms once before calling `removeSelectedDishes`. Reuse the same helper from the existing single-dish remove path so every local removal reindexes positions.

- [ ] **Step 5: Add a compact accessible selection toolbar and per-dish checkbox**

Place the toolbar immediately above the dish cards. The checkbox label must describe the dish, selected controls must remain visible at phone widths, and destructive buttons must use the existing visual language rather than a new component system.

- [ ] **Step 6: Implement whole-menu deletion**

```ts
async function deleteMenu() {
  if (!menu || deleting) return;
  if (!window.confirm(
    'Delete this menu permanently? Menus used in procurement history cannot be deleted.',
  )) return;
  setDeleting(true);
  setError('');
  try {
    const response = await workspaceMutationFetch(
      `/api/menus/${encodeURIComponent(menu.id)}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: menu.version }),
      },
    );
    if (!response.ok) {
      throw new Error((await problemMessage(
        response,
        'We could not delete this menu.',
      )).message);
    }
    router.replace('/menus');
    router.refresh();
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : 'We could not delete this menu.');
  } finally {
    setDeleting(false);
  }
}
```

Disable save, approve, and delete while deletion is running. Update the test router mock to include `refresh`.

- [ ] **Step 7: Run the focused UI test**

Run: `npm test -- --runTestsByPath __tests__/ui/menu-editor.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the editor change**

```bash
git add src/components/menus/MenuEditor.tsx src/components/menus/menu-editor.module.css __tests__/ui/menu-editor.test.tsx
git commit -m "feat: manage and delete menu dishes"
```

### Task 7: Verify the complete menu change

**Files:**
- Verify: all modified menu files

- [ ] **Step 1: Run the combined focused suite**

Run: `npm test -- --runTestsByPath __tests__/menu/photo-intake.test.ts __tests__/menu/menu-service.test.ts __tests__/api/menus.test.ts __tests__/ui/menu-editor.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run the complete project checks**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Perform focused browser QA**

Verify a desktop and phone viewport: OCR a multi-photo menu, confirm cleaned lines remain editable, select one/several/all dishes, save removals, delete an unused menu, and confirm a used menu shows the history explanation. Confirm no billing prompt, external AI request, or paid-service setup appears.

- [ ] **Step 4: Inspect the final diff for scope and generated noise**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the planned source, test, CSS, and documentation files are changed. Preserve `chroma_data/` and `scripts/show-tables.sh` without staging them.

- [ ] **Step 5: Commit any verification-only correction**

Only if the checks required a real code correction, stage only the already listed menu source or test file that was corrected, then commit it with `git commit -m "fix: finish menu cleanup verification"`.
