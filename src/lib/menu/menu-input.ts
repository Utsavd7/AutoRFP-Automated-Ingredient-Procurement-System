const MAX_MENU_BYTES = 100_000;

type MenuInputErrors = Record<string, string[]>;

export type MenuInputResult =
  | { ok: true; value: { menuText: string } }
  | { ok: false; errors: MenuInputErrors };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUrlLike(value: string) {
  return /^(?:[a-z][a-z\d+.-]*:\/\/|\/\/|www\.)\S+/i.test(value.trim());
}

export function parseMenuInput(body: unknown): MenuInputResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      errors: { body: ['Expected a JSON object.'] },
    };
  }

  const errors: MenuInputErrors = {};
  const menuText = body.menuText;

  if (Object.prototype.hasOwnProperty.call(body, 'sourceUrl')) {
    errors.sourceUrl = ['Source URLs are not accepted. Paste the menu text instead.'];
  }

  if (typeof menuText !== 'string' || !menuText.trim()) {
    errors.menuText = ['Menu text is required.'];
  } else if (isUrlLike(menuText)) {
    errors.menuText = ['URLs are not accepted. Paste the menu text instead.'];
  } else if (new TextEncoder().encode(menuText).byteLength > MAX_MENU_BYTES) {
    errors.menuText = ['Menu text must be 100,000 UTF-8 bytes or fewer.'];
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { menuText: (menuText as string).trim() } };
}
