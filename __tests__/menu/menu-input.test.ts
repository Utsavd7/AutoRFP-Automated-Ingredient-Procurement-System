import { parseMenuInput } from '@/lib/menu/menu-input';

describe('parseMenuInput', () => {
  test.each([
    ['a missing body', undefined],
    ['null', null],
    ['a string', 'Paneer Tikka'],
    ['an array', ['Paneer Tikka']],
  ])('rejects %s instead of an object body', (_label, body) => {
    const result = parseMenuInput(body);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.body).toBeDefined();
  });

  test.each([undefined, null, '', '   \n  '])(
    'rejects missing or blank menuText: %p',
    (menuText) => {
      const result = parseMenuInput({ menuText });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.menuText).toBeDefined();
    },
  );

  test.each([
    'https://restaurant.example/menu',
    'http://restaurant.example/menu.pdf',
    'ftp://restaurant.example/menu.txt',
    'www.restaurant.example/menu',
    'data:image/png;base64,AA==',
    'blob:https://restaurant.example/photo-id',
    'file:///Users/owner/menu.pdf',
  ])('rejects URL-like menu text: %s', (menuText) => {
    const result = parseMenuInput({ menuText });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.menuText).toBeDefined();
  });

  it('rejects any sourceUrl key even when its value is empty', () => {
    const result = parseMenuInput({ menuText: 'Paneer Tikka', sourceUrl: null });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.sourceUrl).toBeDefined();
  });

  it('rejects unknown top-level and nested fields instead of silently trusting them', () => {
    const topLevel = parseMenuInput({
      menuText: 'Paneer Tikka',
      tenantId: 'client-controlled-tenant',
    });
    const nested = parseMenuInput({
      menuText: 'Paneer Tikka',
      source: {
        kind: 'OCR',
        documentKind: 'MENU',
        lines: [{ text: 'Paneer Tikka', confidence: 0.92, imageBase64: 'data:image/png;base64,AA==' }],
      },
    });

    expect(topLevel).toEqual(expect.objectContaining({ ok: false }));
    expect(nested).toEqual(expect.objectContaining({ ok: false }));
  });

  it('accepts bounded OCR text and transient confidence evidence without retaining image data', () => {
    expect(parseMenuInput({
      menuText: 'Tomato\nOnion',
      source: {
        kind: 'OCR',
        documentKind: 'BUYING_LIST',
        lines: [
          { text: 'Tomato', confidence: 0.94 },
          { text: 'Onion', confidence: 0.71 },
        ],
      },
    })).toEqual({
      ok: true,
      value: {
        menuText: 'Tomato\nOnion',
        source: {
          kind: 'OCR',
          canonicalUrl: null,
          permissionConfirmed: false,
        },
      },
    });
  });

  test.each([
    ['an unsupported document kind', { documentKind: 'PHOTO' }],
    ['confidence above one', { lines: [{ text: 'Tomato', confidence: 1.01 }, { text: 'Onion', confidence: 0.8 }] }],
    ['confidence below zero', { lines: [{ text: 'Tomato', confidence: -0.01 }, { text: 'Onion', confidence: 0.8 }] }],
    ['non-finite confidence', { lines: [{ text: 'Tomato', confidence: Number.NaN }, { text: 'Onion', confidence: 0.8 }] }],
    ['text that disagrees with the reviewed lines', { lines: [{ text: 'Potato', confidence: 0.9 }] }],
  ])('rejects OCR payload with %s', (_label, change) => {
    const source = {
      kind: 'OCR',
      documentKind: 'BUYING_LIST',
      lines: [
        { text: 'Tomato', confidence: 0.94 },
        { text: 'Onion', confidence: 0.71 },
      ],
      ...change,
    };
    expect(parseMenuInput({ menuText: 'Tomato\nOnion', source }))
      .toEqual(expect.objectContaining({ ok: false }));
  });

  it('accepts only a confirmed canonical permitted URL provenance value', () => {
    expect(parseMenuInput({
      menuText: 'Paneer Tikka',
      source: {
        kind: 'PERMITTED_URL',
        canonicalUrl: 'https://restaurant.example/menu',
        permissionConfirmed: true,
      },
    })).toEqual({
      ok: true,
      value: {
        menuText: 'Paneer Tikka',
        source: {
          kind: 'PERMITTED_URL',
          canonicalUrl: 'https://restaurant.example/menu',
          permissionConfirmed: true,
        },
      },
    });
    expect(parseMenuInput({
      menuText: 'Paneer Tikka',
      source: {
        kind: 'PERMITTED_URL',
        canonicalUrl: 'https://restaurant.example/menu?tracking=1',
        permissionConfirmed: true,
      },
    })).toEqual(expect.objectContaining({ ok: false }));
  });

  it('measures the 100,000-byte limit as UTF-8 bytes', () => {
    const result = parseMenuInput({ menuText: '₹'.repeat(33_334) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.menuText).toBeDefined();
  });

  it('accepts exactly 100,000 UTF-8 bytes', () => {
    const menuText = 'a'.repeat(100_000);

    expect(parseMenuInput({ menuText })).toEqual({
      ok: true,
      value: { menuText },
    });
  });

  it('accepts and trims valid multiline Indian menu text', () => {
    const menuText = `
      Paneer Tikka - ₹320
      Masala Dosa - ₹180
      Dal Makhani - ₹260
    `;

    expect(parseMenuInput({ menuText })).toEqual({
      ok: true,
      value: {
        menuText:
          'Paneer Tikka - ₹320\n      Masala Dosa - ₹180\n      Dal Makhani - ₹260',
      },
    });
  });
});
