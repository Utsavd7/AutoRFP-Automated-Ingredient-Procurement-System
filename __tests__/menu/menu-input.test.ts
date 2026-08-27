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
