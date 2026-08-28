import { POST } from '@/app/api/parse-menu/route';
import { requireApiTenant } from '@/lib/api/require-api-tenant';
import { createMenuDraft } from '@/lib/menu/create-menu-draft';

jest.mock('@/lib/api/require-api-tenant', () => ({
  requireApiTenant: jest.fn(),
}));

jest.mock('@/lib/menu/create-menu-draft', () => ({
  createMenuDraft: jest.fn(),
}));

const postMenu = (menuText: string) =>
  POST(
    new Request('http://localhost/api/parse-menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menuText, tenantId: 'client-controlled-tenant' }),
    }),
  );

describe('parse-menu persistence', () => {
  const menuCreate = jest.mocked(createMenuDraft);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireApiTenant).mockResolvedValue({
      tenant: { id: 'session-tenant' },
      response: null,
    } as never);
  });

  it('persists the menu and every recipe with one nested create', async () => {
    const recipes = [
      { id: 'recipe-1', name: 'Paneer Tikka', ingredients: [] },
      { id: 'recipe-2', name: 'Masala Dosa', ingredients: [] },
    ];
    menuCreate.mockResolvedValue({ id: 'menu-1', recipes } as never);

    const response = await postMenu('Paneer Tikka\nMasala Dosa');

    expect(response.status).toBe(200);
    expect(menuCreate).toHaveBeenCalledTimes(1);
    expect(menuCreate).toHaveBeenCalledWith({
      tenantId: 'session-tenant',
      menuText: 'Paneer Tikka\nMasala Dosa',
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      menuId: 'menu-1',
      recipes,
      modelSource: 'Deterministic review draft',
      requiresReview: true,
    });
  });

  it('returns a generic problem response when the atomic create fails', async () => {
    menuCreate.mockRejectedValue(
      new Error('database URL contains private connection details'),
    );

    const response = await postMenu('Dal Makhani');
    const problem = await response.json();

    expect(menuCreate).toHaveBeenCalledWith({
      tenantId: 'session-tenant',
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
});
