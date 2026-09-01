import { POST as approveMenu } from '@/app/api/menus/[id]/approve/route';
import { DELETE as deleteMenu, GET as getMenu, PUT as updateMenu } from '@/app/api/menus/[id]/route';
import { GET as listMenus, POST as createMenu } from '@/app/api/menus/route';
import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
import {
  approveReviewedMenu,
  createReviewedMenuDraft,
  deleteReviewedMenu,
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
  deleteReviewedMenu: jest.fn(),
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
  user: { id: 'member-a', tenantId: 'tenant-a', role: 'MEMBER', isActive: true },
};

const document: MenuDocumentV1 = {
  v: 1,
  source: { kind: 'MANUAL', canonicalUrl: null, permissionConfirmed: false },
  dishes: [
    {
      id: 'd1',
      name: 'Dal Makhani',
      position: 0,
      ingredients: [
        {
          id: 'i1',
          itemKey: 'urad-dal',
          name: 'Urad dal',
          quantity: '2.5',
          unit: 'KILOGRAM',
          specification: { v: 1, category: 'OTHER' },
        },
      ],
    },
  ],
};

const draft = { name: 'Dinner menu', document };
const updateBody = { ...draft, expectedVersion: 1 };

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

describe('document-backed menu API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue(context as never);
  });

  it('passes only the authenticated actor and document draft through create/update/approval', async () => {
    jest.mocked(createReviewedMenuDraft).mockResolvedValue({ id: 'menu-a' } as never);
    jest.mocked(updateReviewedMenuDraft).mockResolvedValue({ id: 'menu-a', version: 2 } as never);
    jest.mocked(approveReviewedMenu).mockResolvedValue({ id: 'menu-a', version: 3 } as never);
    jest.mocked(deleteReviewedMenu).mockResolvedValue({ id: 'menu-a' } as never);

    const created = await createMenu(
      jsonRequest('http://localhost/api/menus', 'POST', draft),
    );
    const updated = await updateMenu(
      jsonRequest('http://localhost/api/menus/menu-a', 'PUT', updateBody),
      routeContext('menu-a') as never,
    );
    const approved = await approveMenu(
      jsonRequest('http://localhost/api/menus/menu-a/approve', 'POST', {
        expectedVersion: 2,
      }),
      routeContext('menu-a') as never,
    );
    const deleted = await deleteMenu(
      jsonRequest('http://localhost/api/menus/menu-a', 'DELETE', { expectedVersion: 2 }),
      routeContext('menu-a') as never,
    );

    expect(createReviewedMenuDraft).toHaveBeenCalledWith({ actor: {
      tenantId: 'tenant-a', userId: 'member-a',
    }, draft });
    expect(updateReviewedMenuDraft).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      menuId: 'menu-a',
      expectedVersion: 1,
      draft: updateBody,
    });
    expect(approveReviewedMenu).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      menuId: 'menu-a',
      expectedVersion: 2,
    });
    expect(deleteReviewedMenu).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      menuId: 'menu-a',
      expectedVersion: 2,
    });
    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(approved.status).toBe(200);
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deletedMenuId: 'menu-a' });
  });

  it('lists summary rows and returns detail proposals from tenant-scoped services', async () => {
    jest.mocked(listReviewedMenus).mockResolvedValue({
      menus: [{ id: 'menu-a', name: 'Dinner menu' }],
      nextCursor: null,
    } as never);
    jest.mocked(getReviewedMenu).mockResolvedValue({
      id: 'menu-a',
      document,
      cleanupProposals: [],
      ingredientSuggestionsByDishId: { d1: [] },
    } as never);

    const list = await listMenus(
      new Request('http://localhost/api/menus?limit=20&cursor=menu-before'),
    );
    const detail = await getMenu(
      new Request('http://localhost/api/menus/menu-a'),
      routeContext('menu-a') as never,
    );

    expect(listReviewedMenus).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      cursor: 'menu-before',
      limit: 20,
    });
    expect(getReviewedMenu).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      menuId: 'menu-a',
    });
    await expect(list.json()).resolves.toEqual({
      menus: [{ id: 'menu-a', name: 'Dinner menu' }],
      nextCursor: null,
    });
    await expect(detail.json()).resolves.toMatchObject({
      menu: { document, cleanupProposals: [], ingredientSuggestionsByDishId: { d1: [] } },
    });
  });

  it('marks every successful menu response private and no-store', async () => {
    jest.mocked(createReviewedMenuDraft).mockResolvedValue({ id: 'menu-a' } as never);
    jest.mocked(updateReviewedMenuDraft).mockResolvedValue({ id: 'menu-a' } as never);
    jest.mocked(approveReviewedMenu).mockResolvedValue({ id: 'menu-a' } as never);
    jest.mocked(deleteReviewedMenu).mockResolvedValue({ id: 'menu-a' } as never);
    jest.mocked(listReviewedMenus).mockResolvedValue({ menus: [], nextCursor: null } as never);
    jest.mocked(getReviewedMenu).mockResolvedValue({ id: 'menu-a', document } as never);

    const responses = await Promise.all([
      listMenus(new Request('http://localhost/api/menus')),
      getMenu(new Request('http://localhost/api/menus/menu-a'), routeContext('menu-a') as never),
      createMenu(jsonRequest('http://localhost/api/menus', 'POST', draft)),
      updateMenu(jsonRequest('http://localhost/api/menus/menu-a', 'PUT', updateBody), routeContext('menu-a') as never),
      approveMenu(jsonRequest('http://localhost/api/menus/menu-a/approve', 'POST', { expectedVersion: 1 }), routeContext('menu-a') as never),
      deleteMenu(jsonRequest('http://localhost/api/menus/menu-a', 'DELETE', { expectedVersion: 1 }), routeContext('menu-a') as never),
    ]);

    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it('returns private safe problems for invalid, missing, incomplete, and unauthenticated menus', async () => {
    jest.mocked(createReviewedMenuDraft).mockRejectedValue(
      new MenuValidationError({ document: ['Menu document contains unknown key extra.'] }),
    );
    jest.mocked(getReviewedMenu).mockRejectedValue(new MenuNotFoundError());
    jest.mocked(approveReviewedMenu).mockRejectedValue(
      new MenuConflictError('Menu review is incomplete.'),
    );
    jest.mocked(deleteReviewedMenu).mockRejectedValue(new MenuConflictError('Menu has changed.'));

    const invalid = await createMenu(jsonRequest('http://localhost/api/menus', 'POST', draft));
    const missing = await getMenu(new Request('http://localhost/api/menus/menu-b'), routeContext('menu-b') as never);
    const incomplete = await approveMenu(
      jsonRequest('http://localhost/api/menus/menu-a/approve', 'POST', { expectedVersion: 1 }),
      routeContext('menu-a') as never,
    );
    const conflict = await deleteMenu(
      jsonRequest('http://localhost/api/menus/menu-a', 'DELETE', { expectedVersion: 1 }),
      routeContext('menu-a') as never,
    );
    jest.mocked(requireAccountContext).mockResolvedValue(null);
    const unauthorized = await listMenus(new Request('http://localhost/api/menus'));
    const unauthorizedDelete = await deleteMenu(
      jsonRequest('http://localhost/api/menus/menu-a', 'DELETE', { expectedVersion: 1 }),
      routeContext('menu-a') as never,
    );

    expect([invalid.status, missing.status, incomplete.status, conflict.status, unauthorized.status, unauthorizedDelete.status]).toEqual([
      422, 404, 409, 409, 401, 401,
    ]);
    for (const response of [invalid, missing, incomplete, conflict, unauthorized, unauthorizedDelete]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    await expect(missing.json()).resolves.not.toHaveProperty('tenantId');
  });

  it('keeps unexpected menu failures private and generic on every route', async () => {
    const internal = new Error('database URL contains private credentials');
    jest.mocked(listReviewedMenus).mockRejectedValue(internal);
    jest.mocked(getReviewedMenu).mockRejectedValue(internal);
    jest.mocked(createReviewedMenuDraft).mockRejectedValue(internal);
    jest.mocked(updateReviewedMenuDraft).mockRejectedValue(internal);
    jest.mocked(approveReviewedMenu).mockRejectedValue(internal);
    jest.mocked(deleteReviewedMenu).mockRejectedValue(internal);

    const responses = await Promise.all([
      listMenus(new Request('http://localhost/api/menus')),
      getMenu(new Request('http://localhost/api/menus/menu-a'), routeContext('menu-a') as never),
      createMenu(jsonRequest('http://localhost/api/menus', 'POST', draft)),
      updateMenu(jsonRequest('http://localhost/api/menus/menu-a', 'PUT', updateBody), routeContext('menu-a') as never),
      approveMenu(jsonRequest('http://localhost/api/menus/menu-a/approve', 'POST', { expectedVersion: 1 }), routeContext('menu-a') as never),
      deleteMenu(jsonRequest('http://localhost/api/menus/menu-a', 'DELETE', { expectedVersion: 1 }), routeContext('menu-a') as never),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      await expect(response.clone().text()).resolves.not.toContain('database URL');
    }
  });

  it.each([
    ['create', () => createMenu(new Request('http://localhost/api/menus', {
      method: 'POST', headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
    }))],
    ['update', () => updateMenu(new Request('http://localhost/api/menus/menu-a', {
      method: 'PUT', headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: JSON.stringify(updateBody),
    }), routeContext('menu-a') as never)],
    ['approve', () => approveMenu(new Request('http://localhost/api/menus/menu-a/approve', {
      method: 'POST', headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }),
    }), routeContext('menu-a') as never)],
    ['delete', () => deleteMenu(new Request('http://localhost/api/menus/menu-a', {
      method: 'DELETE', headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }),
    }), routeContext('menu-a') as never)],
  ])('rejects cross-origin %s before authentication or menu work', async (_label, call) => {
    jest.mocked(requireAccountContext).mockClear();
    const response = await call();
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(requireAccountContext).not.toHaveBeenCalled();
    if (_label === 'delete') expect(deleteReviewedMenu).not.toHaveBeenCalled();
  });

  it('rejects oversized ignored JSON before service work', async () => {
    const response = await createMenu(
      jsonRequest('http://localhost/api/menus', 'POST', {
        ...draft,
        ignored: 'x'.repeat(525_000),
      }),
    );
    expect(response.status).toBe(413);
    expect(createReviewedMenuDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['missing content type', new Request('http://localhost/api/menus/menu-a', {
      method: 'DELETE', headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ expectedVersion: 1 }),
    }), 415],
    ['invalid JSON', new Request('http://localhost/api/menus/menu-a', {
      method: 'DELETE', headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: '{',
    }), 400],
    ['oversized JSON', jsonRequest('http://localhost/api/menus/menu-a', 'DELETE', {
      expectedVersion: 1, ignored: 'x'.repeat(525_000),
    }), 413],
  ])('rejects delete requests with %s before menu work', async (_label, request, status) => {
    const response = await deleteMenu(request, routeContext('menu-a') as never);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(deleteReviewedMenu).not.toHaveBeenCalled();
  });
});
