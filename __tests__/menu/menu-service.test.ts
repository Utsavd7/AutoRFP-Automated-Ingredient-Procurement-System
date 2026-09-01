import { Prisma } from '@prisma/client';

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
  validateMenuDraftInput,
} from '@/lib/menu/menu-service';

const document: MenuDocumentV1 = {
  v: 1,
  source: {
    kind: 'MANUAL',
    canonicalUrl: null,
    permissionConfirmed: false,
  },
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

function clientWith(transaction: Record<string, unknown>) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        currentUser: 'autorfp_app',
        rolsuper: false,
        rolbypassrls: false,
        hasBypassMembership: false,
      },
    ]),
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(transaction),
    ),
  };
}

const actor = { tenantId: 'tenant-a', userId: 'member-a' };

async function expectMenuServiceError(
  operation: () => unknown,
  ErrorClass: typeof MenuConflictError | typeof MenuNotFoundError,
  expected: { message: string; code: string; status: number },
) {
  try {
    await operation();
    throw new Error('Expected the menu service to reject.');
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error).toMatchObject(expected);
  }
}

describe('document-backed menu service', () => {
  it('validates the full document before persisting one Menu row', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'menu-a',
      tenantId: actor.tenantId,
      name: 'Dinner menu',
      status: 'DRAFT',
      version: 1,
      document,
      sourceText: null,
    });
    const transaction = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(0),
      menu: { create },
    };
    const client = clientWith(transaction);

    await expect(
      createReviewedMenuDraft(
        { actor, draft: { name: 'Dinner menu', document } },
        client as never,
      ),
    ).resolves.toMatchObject({ id: 'menu-a', document });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Dinner menu',
        status: 'DRAFT',
        sourceText: null,
        document,
      }),
      select: expect.objectContaining({ document: true }),
    });
    expect(create.mock.calls[0]![0].data).not.toHaveProperty('recipes');
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveProperty('recipe');
    expect(transaction).not.toHaveProperty('ingredient');
  });

  it('rejects an invalid or oversized document before opening Prisma', async () => {
    const client = clientWith({});
    const invalid = { ...document, ignored: true };

    expect(() =>
      validateMenuDraftInput({ name: 'Dinner menu', document: invalid }),
    ).toThrow(MenuValidationError);
    await expect(
      createReviewedMenuDraft(
        { actor, draft: { name: 'Dinner menu', document: invalid } },
        client as never,
      ),
    ).rejects.toBeInstanceOf(MenuValidationError);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('lists summary scalars without loading documents, relation counts, or mutating source text', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'menu-a',
        name: 'Dinner menu',
        status: 'DRAFT',
        version: 1,
        approvedAt: null,
        approvedByUserId: null,
        createdByUserId: 'member-a',
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        updatedAt: new Date('2026-08-31T00:00:00.000Z'),
      },
    ]);
    const transaction = { $queryRaw: jest.fn(), menu: { findMany } };

    await expect(
      listReviewedMenus({ actor }, clientWith(transaction) as never),
    ).resolves.toMatchObject({ menus: [{ id: 'menu-a' }], nextCursor: null });

    const query = findMany.mock.calls[0]![0];
    expect(query.select).not.toHaveProperty('document');
    expect(query.select).not.toHaveProperty('_count');
    expect(transaction).not.toHaveProperty('$executeRaw');
  });

  it('validates detail documents and returns bounded cleanup and ingredient proposals without GET writes', async () => {
    const current = {
      id: 'menu-a',
      tenantId: 'tenant-a',
      name: 'Dinner menu',
      status: 'DRAFT',
      version: 1,
      document,
      sourceText: 'Dal Makhani',
      approvedAt: null,
      approvedByUserId: null,
      createdByUserId: 'member-a',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
      updatedAt: new Date('2026-08-31T00:00:00.000Z'),
    };
    const findFirst = jest.fn().mockResolvedValue(current);
    const findMany = jest.fn().mockResolvedValue([]);
    const transaction = {
      $queryRaw: jest.fn(),
      menu: { findFirst, findMany },
    };

    await expect(
      getReviewedMenu({ actor, menuId: 'menu-a' }, clientWith(transaction) as never),
    ).resolves.toEqual(
      expect.objectContaining({
        document,
        cleanupProposals: expect.any(Array),
        ingredientSuggestionsByDishId: expect.objectContaining({
          d1: expect.any(Array),
        }),
      }),
    );
    expect(transaction).not.toHaveProperty('$executeRaw');
  });

  it('rejects bad optimistic versions before update or approval work', async () => {
    const client = clientWith({});
    await expect(
      updateReviewedMenuDraft(
        {
          actor,
          menuId: 'menu-a',
          expectedVersion: 0,
          draft: { name: 'Dinner menu', document },
        },
        client as never,
      ),
    ).rejects.toBeInstanceOf(MenuValidationError);
    await expect(
      approveReviewedMenu(
        { actor, menuId: 'menu-a', expectedVersion: Number.NaN },
        client as never,
      ),
    ).rejects.toBeInstanceOf(MenuValidationError);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'APPROVED'] as const)(
    'deletes an unused %s menu and records its version',
    async (status) => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'menu-a',
        status,
        version: 3,
      });
      const count = jest.fn().mockResolvedValue(0);
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-a' });
      const transaction = {
        $queryRaw: jest.fn(),
        menu: { findFirst, deleteMany },
        procurementRequest: { count },
        auditEvent: { create: auditCreate },
      };

      await expect(
        deleteReviewedMenu(
          { actor, menuId: 'menu-a', expectedVersion: 3 },
          clientWith(transaction) as never,
        ),
      ).resolves.toEqual({ id: 'menu-a' });

      expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { tenantId: actor.tenantId, id: 'menu-a' },
      }));
      expect(count).toHaveBeenCalledWith({
        where: { tenantId: actor.tenantId, menuId: 'menu-a' },
      });
      expect(deleteMany).toHaveBeenCalledWith({
        where: { tenantId: actor.tenantId, id: 'menu-a', version: 3 },
      });
      expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: 'menu.deleted',
          entityId: 'menu-a',
          metadata: { version: 3 },
        }),
      }));
    },
  );

  it('keeps a menu with procurement history intact', async () => {
    const deleteMany = jest.fn();
    const transaction = {
      $queryRaw: jest.fn(),
      menu: { findFirst: jest.fn().mockResolvedValue({ id: 'menu-a', version: 3 }), deleteMany },
      procurementRequest: { count: jest.fn().mockResolvedValue(1) },
      auditEvent: { create: jest.fn() },
    };

    await expectMenuServiceError(
      () => deleteReviewedMenu(
        { actor, menuId: 'menu-a', expectedVersion: 3 },
        clientWith(transaction) as never,
      ),
      MenuConflictError,
      {
        message: 'This menu has procurement history and cannot be deleted.',
        code: 'MENU_CONFLICT',
        status: 409,
      },
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('maps a deletion foreign-key race to the procurement-history conflict', async () => {
    const auditCreate = jest.fn();
    const transaction = {
      $queryRaw: jest.fn(),
      menu: {
        findFirst: jest.fn().mockResolvedValue({ id: 'menu-a', version: 3 }),
        deleteMany: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed.', {
            code: 'P2003',
            clientVersion: 'test',
          }),
        ),
      },
      procurementRequest: { count: jest.fn().mockResolvedValue(0) },
      auditEvent: { create: auditCreate },
    };

    await expectMenuServiceError(
      () => deleteReviewedMenu(
        { actor, menuId: 'menu-a', expectedVersion: 3 },
        clientWith(transaction) as never,
      ),
      MenuConflictError,
      {
        message: 'This menu has procurement history and cannot be deleted.',
        code: 'MENU_CONFLICT',
        status: 409,
      },
    );
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects a stale menu version before checking procurement history', async () => {
    const count = jest.fn();
    const deleteMany = jest.fn();
    const transaction = {
      $queryRaw: jest.fn(),
      menu: { findFirst: jest.fn().mockResolvedValue({ id: 'menu-a', version: 4 }), deleteMany },
      procurementRequest: { count },
      auditEvent: { create: jest.fn() },
    };

    await expectMenuServiceError(
      () => deleteReviewedMenu(
        { actor, menuId: 'menu-a', expectedVersion: 3 },
        clientWith(transaction) as never,
      ),
      MenuConflictError,
      {
        message: 'This menu changed after you opened it. Reload before continuing.',
        code: 'MENU_CONFLICT',
        status: 409,
      },
    );
    expect(count).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('does not reveal missing or cross-tenant menus', async () => {
    const count = jest.fn();
    const deleteMany = jest.fn();
    const transaction = {
      $queryRaw: jest.fn(),
      menu: { findFirst: jest.fn().mockResolvedValue(null), deleteMany },
      procurementRequest: { count },
      auditEvent: { create: jest.fn() },
    };

    await expectMenuServiceError(
      () => deleteReviewedMenu(
        { actor, menuId: 'menu-a', expectedVersion: 3 },
        clientWith(transaction) as never,
      ),
      MenuNotFoundError,
      { message: 'Menu not found.', code: 'MENU_NOT_FOUND', status: 404 },
    );
    expect(count).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
