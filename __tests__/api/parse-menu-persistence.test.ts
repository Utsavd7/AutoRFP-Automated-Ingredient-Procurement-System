import { POST } from '@/app/api/parse-menu/route';
import {
  createDeterministicMenuDraft,
  MenuValidationError,
} from '@/lib/menu/menu-service';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({
  requireAccountContext: jest.fn(),
}));

jest.mock('@/lib/menu/menu-service', () => ({
  createDeterministicMenuDraft: jest.fn(),
  MenuValidationError: jest.requireActual('@/lib/menu/menu-service')
    .MenuValidationError,
}));

const postMenu = (menuText: string) =>
  POST(
    new Request('http://localhost/api/parse-menu', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify({ menuText, tenantId: 'client-controlled-tenant' }),
    }),
  );

describe('parse-menu persistence', () => {
  const menuCreate = jest.mocked(createDeterministicMenuDraft);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue({
      tenant: { id: 'session-tenant' },
      user: { id: 'member-a' },
    } as never);
  });

  it('persists one v1 menu document and keeps the exact response contract', async () => {
    menuCreate.mockResolvedValue({
      id: 'menu-1',
      document: {
        v: 1,
        source: {
          kind: 'PASTE',
          canonicalUrl: null,
          permissionConfirmed: false,
        },
        dishes: [
          { id: 'd1', name: 'Paneer Tikka', position: 0, ingredients: [] },
          { id: 'd2', name: 'Masala Dosa', position: 1, ingredients: [] },
        ],
      },
    } as never);

    const response = await postMenu('Paneer Tikka\nMasala Dosa');

    expect(response.status).toBe(200);
    expect(menuCreate).toHaveBeenCalledTimes(1);
    expect(menuCreate).toHaveBeenCalledWith({
      actor: { tenantId: 'session-tenant', userId: 'member-a' },
      name: 'Menu draft',
      menuText: 'Paneer Tikka\nMasala Dosa',
    });
    await expect(response.json()).resolves.toEqual({ menuId: 'menu-1' });
  });

  it('returns a generic problem response when the atomic create fails', async () => {
    menuCreate.mockRejectedValue(
      new Error('database URL contains private connection details'),
    );

    const response = await postMenu('Dal Makhani');
    const problem = await response.json();

    expect(menuCreate).toHaveBeenCalledWith({
      actor: { tenantId: 'session-tenant', userId: 'member-a' },
      name: 'Menu draft',
      menuText: 'Dal Makhani',
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    );
    expect(problem).toEqual({
      type: 'about:blank',
      status: 500,
      title: 'Unable to save menu',
      detail: 'The menu draft could not be saved. Try again.',
    });
    expect(JSON.stringify(problem)).not.toContain('database URL');
  });

  it('returns 422 when a deterministic dish exceeds the review boundary', async () => {
    menuCreate.mockRejectedValue(
      new MenuValidationError({
        menuText: ['Dish names must be 160 UTF-8 bytes or fewer.'],
      }),
    );

    const response = await postMenu('₹'.repeat(54));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      title: 'Invalid menu',
      errors: {
        menuText: ['Dish names must be 160 UTF-8 bytes or fewer.'],
      },
    });
  });

  it('rejects a huge ignored field before deterministic parsing', async () => {
    const response = await POST(
      new Request('http://localhost/api/parse-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuText: 'Dal Makhani',
          ignored: 'x'.repeat(525_000),
        }),
      }),
    );

    expect(response.status).toBe(413);
    expect(menuCreate).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin parse before authentication or persistence', async () => {
    jest.mocked(requireAccountContext).mockClear();
    const response = await POST(new Request('http://localhost/api/parse-menu', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ menuText: 'Dal Makhani' }),
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(requireAccountContext).not.toHaveBeenCalled();
    expect(menuCreate).not.toHaveBeenCalled();
  });
});
