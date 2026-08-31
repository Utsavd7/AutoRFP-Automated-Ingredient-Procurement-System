import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
import {
  approveReviewedMenu,
  createReviewedMenuDraft,
  getReviewedMenu,
  listReviewedMenus,
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
});
