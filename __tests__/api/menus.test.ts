import { GET as listMenus, POST as createMenu } from '@/app/api/menus/route';
import {
  GET as getMenu,
  PUT as updateMenu,
} from '@/app/api/menus/[id]/route';
import { POST as approveMenu } from '@/app/api/menus/[id]/approve/route';
import {
  approveReviewedMenu,
  createReviewedMenuDraft,
  getReviewedMenu,
  listReviewedMenus,
  MenuConflictError,
  MenuNotFoundError,
  MenuValidationError,
  updateReviewedMenuDraft,
} from '@/lib/menu/menu-service';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({
  requireAccountContext: jest.fn(),
}));

jest.mock('@/lib/menu/menu-service', () => ({
  approveReviewedMenu: jest.fn(),
  createReviewedMenuDraft: jest.fn(),
  getReviewedMenu: jest.fn(),
  listReviewedMenus: jest.fn(),
  updateReviewedMenuDraft: jest.fn(),
  MenuValidationError: jest.requireActual('@/lib/menu/menu-service')
    .MenuValidationError,
  MenuNotFoundError: jest.requireActual('@/lib/menu/menu-service')
    .MenuNotFoundError,
  MenuConflictError: jest.requireActual('@/lib/menu/menu-service')
    .MenuConflictError,
}));

const context = {
  tenant: { id: 'tenant-a' },
  user: {
    id: 'member-a',
    tenantId: 'tenant-a',
    role: 'MEMBER',
    isActive: true,
  },
};

const body = {
  expectedVersion: 1,
  name: 'Dinner menu',
  dishes: [
    {
      name: 'Dal makhani',
      ingredients: [{ name: 'Urad dal', quantity: '2.5', unit: 'kg' }],
    },
  ],
};

const jsonRequest = (url: string, method: string, value: unknown) =>
  new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: new URL(url).origin,
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify(value),
  });

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

describe('reviewed menu API', () => {
  beforeEach(() => {
    jest.mocked(createReviewedMenuDraft).mockReset();
    jest.mocked(listReviewedMenus).mockReset();
    jest.mocked(getReviewedMenu).mockReset();
    jest.mocked(updateReviewedMenuDraft).mockReset();
    jest.mocked(approveReviewedMenu).mockReset();
    jest.mocked(requireAccountContext).mockReset();
    jest.mocked(requireAccountContext).mockResolvedValue(context as never);
  });

  it('lets an active member create a manual draft without trusting client tenancy', async () => {
    jest.mocked(createReviewedMenuDraft).mockResolvedValue({ id: 'menu-a' } as never);

    const response = await createMenu(
      jsonRequest('http://localhost/api/menus', 'POST', {
        ...body,
        tenantId: 'tenant-b',
        status: 'APPROVED',
        approvedByUserId: 'owner-b',
      }),
    );

    expect(response.status).toBe(201);
    expect(createReviewedMenuDraft).toHaveBeenCalledWith({
      actor: { userId: 'member-a', tenantId: 'tenant-a' },
      draft: expect.objectContaining(body),
    });
    await expect(response.json()).resolves.toEqual({ menu: { id: 'menu-a' } });
  });

  it('lists bounded tenant menus and loads one tenant-owned menu', async () => {
    jest.mocked(listReviewedMenus).mockResolvedValue({
      menus: [{ id: 'menu-a' }],
      nextCursor: null,
    } as never);
    jest.mocked(getReviewedMenu).mockResolvedValue({ id: 'menu-a' } as never);

    const listResponse = await listMenus(
      new Request('http://localhost/api/menus?limit=20&cursor=menu-before'),
    );
    const getResponse = await getMenu(
      new Request('http://localhost/api/menus/menu-a'),
      routeContext('menu-a') as never,
    );

    expect(listReviewedMenus).toHaveBeenCalledWith({
      actor: { userId: 'member-a', tenantId: 'tenant-a' },
      cursor: 'menu-before',
      limit: 20,
    });
    expect(getReviewedMenu).toHaveBeenCalledWith({
      actor: { userId: 'member-a', tenantId: 'tenant-a' },
      menuId: 'menu-a',
    });
    await expect(listResponse.json()).resolves.toEqual({
      menus: [{ id: 'menu-a' }],
      nextCursor: null,
    });
    await expect(getResponse.json()).resolves.toEqual({ menu: { id: 'menu-a' } });
  });

  it('updates and approves through actor-scoped tenant services', async () => {
    jest.mocked(updateReviewedMenuDraft).mockResolvedValue({
      id: 'menu-a',
      status: 'DRAFT',
    } as never);
    jest.mocked(approveReviewedMenu).mockResolvedValue({
      id: 'menu-a',
      status: 'APPROVED',
    } as never);

    const updateResponse = await updateMenu(
      jsonRequest('http://localhost/api/menus/menu-a', 'PUT', body),
      routeContext('menu-a') as never,
    );
    const approveResponse = await approveMenu(
      jsonRequest(
        'http://localhost/api/menus/menu-a/approve',
        'POST',
        { expectedVersion: 1 },
      ),
      routeContext('menu-a') as never,
    );

    expect(updateReviewedMenuDraft).toHaveBeenCalledWith({
      actor: { userId: 'member-a', tenantId: 'tenant-a' },
      menuId: 'menu-a',
      expectedVersion: 1,
      draft: expect.objectContaining(body),
    });
    expect(approveReviewedMenu).toHaveBeenCalledWith({
      actor: { userId: 'member-a', tenantId: 'tenant-a' },
      menuId: 'menu-a',
      expectedVersion: 1,
    });
    expect(updateResponse.status).toBe(200);
    expect(approveResponse.status).toBe(200);
  });

  it('returns safe public errors for invalid, incomplete, and cross-tenant menus', async () => {
    jest.mocked(createReviewedMenuDraft).mockRejectedValue(
      new MenuValidationError({ name: ['Menu name is required.'] }),
    );
    jest.mocked(getReviewedMenu).mockRejectedValue(new MenuNotFoundError());
    jest.mocked(approveReviewedMenu).mockRejectedValue(
      new MenuConflictError('Menu review is incomplete.'),
    );

    const invalid = await createMenu(
      jsonRequest('http://localhost/api/menus', 'POST', { name: '', dishes: [] }),
    );
    const missing = await getMenu(
      new Request('http://localhost/api/menus/menu-b'),
      routeContext('menu-b') as never,
    );
    const incomplete = await approveMenu(
      jsonRequest(
        'http://localhost/api/menus/menu-a/approve',
        'POST',
        { expectedVersion: 1 },
      ),
      routeContext('menu-a') as never,
    );

    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      title: 'Invalid menu',
      errors: { name: ['Menu name is required.'] },
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.not.toHaveProperty('tenantId');
    expect(incomplete.status).toBe(409);
  });

  it('rejects unauthenticated access before reading or writing menu data', async () => {
    jest.mocked(requireAccountContext).mockResolvedValue(null);

    const responses = await Promise.all([
      listMenus(new Request('http://localhost/api/menus')),
      createMenu(jsonRequest('http://localhost/api/menus', 'POST', body)),
      getMenu(
        new Request('http://localhost/api/menus/menu-a'),
        routeContext('menu-a') as never,
      ),
      updateMenu(
        jsonRequest('http://localhost/api/menus/menu-a', 'PUT', body),
        routeContext('menu-a') as never,
      ),
      approveMenu(
        jsonRequest(
          'http://localhost/api/menus/menu-a/approve',
          'POST',
          { expectedVersion: 1 },
        ),
        routeContext('menu-a') as never,
      ),
    ]);

    expect(responses.every(({ status }) => status === 401)).toBe(true);
    expect(createReviewedMenuDraft).not.toHaveBeenCalled();
    expect(listReviewedMenus).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without calling the service', async () => {
    const response = await createMenu(
      new Request('http://localhost/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    );

    expect(response.status).toBe(400);
    expect(createReviewedMenuDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['create', () => createMenu(new Request('http://localhost/api/menus', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }))],
    ['update', () => updateMenu(new Request('http://localhost/api/menus/menu-a', {
      method: 'PUT',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }), routeContext('menu-a') as never)],
    ['approve', () => approveMenu(new Request('http://localhost/api/menus/menu-a/approve', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    }), routeContext('menu-a') as never)],
  ])('rejects cross-origin %s before authentication or menu work', async (_label, call) => {
    jest.mocked(requireAccountContext).mockClear();
    const response = await call();

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(requireAccountContext).not.toHaveBeenCalled();
    expect(createReviewedMenuDraft).not.toHaveBeenCalled();
    expect(updateReviewedMenuDraft).not.toHaveBeenCalled();
    expect(approveReviewedMenu).not.toHaveBeenCalled();
  });

  it('rejects non-JSON menu writes before authentication', async () => {
    jest.mocked(requireAccountContext).mockClear();
    const response = await createMenu(new Request('http://localhost/api/menus', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'text/plain',
      },
      body: '{}',
    }));

    expect(response.status).toBe(415);
    expect(requireAccountContext).not.toHaveBeenCalled();
  });

  it('requires an expected version for approval', async () => {
    jest.mocked(approveReviewedMenu).mockRejectedValue(
      new MenuValidationError({
        expectedVersion: ['Expected version must be a positive integer.'],
      }),
    );

    const response = await approveMenu(
      jsonRequest('http://localhost/api/menus/menu-a/approve', 'POST', {}),
      routeContext('menu-a') as never,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      errors: {
        expectedVersion: ['Expected version must be a positive integer.'],
      },
    });
  });

  it.each([
    ['create', () => createMenu(
      jsonRequest('http://localhost/api/menus', 'POST', {
        ...body,
        ignored: 'x'.repeat(525_000),
      }),
    )],
    ['update', () => updateMenu(
      jsonRequest('http://localhost/api/menus/menu-a', 'PUT', {
        ...body,
        ignored: 'x'.repeat(525_000),
      }),
      routeContext('menu-a') as never,
    )],
    ['approve', () => approveMenu(
      jsonRequest('http://localhost/api/menus/menu-a/approve', 'POST', {
        expectedVersion: 1,
        ignored: 'x'.repeat(525_000),
      }),
      routeContext('menu-a') as never,
    )],
  ])('rejects an oversized ignored field before JSON parsing on %s', async (_label, call) => {
    const response = await call();

    expect(response.status).toBe(413);
    expect(createReviewedMenuDraft).not.toHaveBeenCalled();
    expect(updateReviewedMenuDraft).not.toHaveBeenCalled();
    expect(approveReviewedMenu).not.toHaveBeenCalled();
  });
});
