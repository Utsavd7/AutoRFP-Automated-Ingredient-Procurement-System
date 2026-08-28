import { Prisma, type PrismaClient } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import {
  formatQuantity,
  normalizeUnit,
  parseQuantityToMilli,
  type ProcurementUnit,
} from '@/lib/domain/quantity';
import {
  buildDeterministicMenuDraft,
  DeterministicMenuDraftError,
} from '@/lib/menu/deterministic-draft';
import { prisma } from '@/lib/prisma';

export const MENU_LIMITS = {
  nameBytes: 160,
  factBytes: 160,
  sourceBytes: 100_000,
  dishes: 250,
  ingredientsPerDish: 50,
  ingredientsTotal: 1_000,
  idBytes: 200,
  listPage: 50,
} as const;

export const MENU_SOURCE_RETENTION_DAYS = 30;

type MenuClient = Pick<PrismaClient, '$queryRaw' | '$transaction'> &
  TenantTransactionHost;

type MenuActor = {
  tenantId: string;
  userId: string;
};

type ValidIngredient = {
  id?: string;
  name: string;
  quantity: string;
  unit: ProcurementUnit;
};

type ValidDish = {
  id?: string;
  name: string;
  ingredients: ValidIngredient[];
};

export type ValidMenuDraft = {
  name: string;
  sourceText: string | null;
  dishes: ValidDish[];
};

type MenuErrors = Record<string, string[]>;

const menuInclude = {
  recipes: {
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
    include: {
      ingredients: {
        orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
      },
    },
  },
} satisfies Prisma.MenuInclude;

export class MenuValidationError extends Error {
  readonly code = 'INVALID_MENU';
  readonly status = 422;

  constructor(readonly errors: MenuErrors) {
    super('The menu contains invalid or unbounded fields.');
    this.name = 'MenuValidationError';
  }
}

export class MenuNotFoundError extends Error {
  readonly code = 'MENU_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Menu not found.');
    this.name = 'MenuNotFoundError';
  }
}

export class MenuConflictError extends Error {
  readonly code = 'MENU_CONFLICT';
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'MenuConflictError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function boundedText(
  value: unknown,
  label: string,
  maximumBytes: number,
  errors: MenuErrors,
  path: string,
) {
  if (typeof value !== 'string' || !value.trim()) {
    errors[path] = [`${label} is required.`];
    return null;
  }

  const normalized = value.trim();
  if (
    byteLength(normalized) > maximumBytes ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    errors[path] = [
      `${label} must be ${maximumBytes} UTF-8 bytes or fewer and contain no control characters.`,
    ];
    return null;
  }

  return normalized;
}

function boundedId(
  value: unknown,
  errors: MenuErrors,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  return (
    boundedText(value, 'ID', MENU_LIMITS.idBytes, errors, path) ?? undefined
  );
}

function sourceText(value: unknown, errors: MenuErrors) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    errors.sourceText = ['Source text must be non-empty text when provided.'];
    return null;
  }

  const normalized = value.trim();
  if (
    byteLength(normalized) > MENU_LIMITS.sourceBytes ||
    normalized.includes('\u0000')
  ) {
    errors.sourceText = [
      `Source text must be ${MENU_LIMITS.sourceBytes.toLocaleString('en-US')} UTF-8 bytes or fewer.`,
    ];
    return null;
  }
  return normalized;
}

export function validateMenuDraftInput(input: unknown): ValidMenuDraft {
  const errors: MenuErrors = {};
  if (!isRecord(input)) {
    throw new MenuValidationError({ body: ['Expected a JSON object.'] });
  }

  if (Array.isArray(input.dishes)) {
    let ingredientCount = 0;
    for (const dish of input.dishes) {
      if (isRecord(dish) && Array.isArray(dish.ingredients)) {
        ingredientCount += dish.ingredients.length;
        if (ingredientCount > MENU_LIMITS.ingredientsTotal) {
          throw new MenuValidationError({
            dishes: [
              `A menu may contain at most ${MENU_LIMITS.ingredientsTotal.toLocaleString('en-US')} ingredients in total.`,
            ],
          });
        }
      }
    }
  }

  const name = boundedText(
    input.name,
    'Menu name',
    MENU_LIMITS.nameBytes,
    errors,
    'name',
  );
  const normalizedSourceText = sourceText(input.sourceText, errors);
  const dishes: ValidDish[] = [];
  const recipeIds = new Set<string>();
  const ingredientIds = new Set<string>();

  if (!Array.isArray(input.dishes)) {
    errors.dishes = ['Dishes must be an array.'];
  } else if (input.dishes.length > MENU_LIMITS.dishes) {
    errors.dishes = [`A menu may contain at most ${MENU_LIMITS.dishes} dishes.`];
  } else {
    input.dishes.forEach((dishValue, dishIndex) => {
      const dishPath = `dishes.${dishIndex}`;
      if (!isRecord(dishValue)) {
        errors[dishPath] = ['Dish must be an object.'];
        return;
      }

      const id = boundedId(dishValue.id, errors, `${dishPath}.id`);
      if (id && recipeIds.has(id)) {
        errors[`${dishPath}.id`] = ['Dish IDs must be unique.'];
      } else if (id) {
        recipeIds.add(id);
      }
      const dishName = boundedText(
        dishValue.name,
        'Dish name',
        MENU_LIMITS.factBytes,
        errors,
        `${dishPath}.name`,
      );
      const ingredients: ValidIngredient[] = [];

      if (!Array.isArray(dishValue.ingredients)) {
        errors[`${dishPath}.ingredients`] = ['Ingredients must be an array.'];
      } else if (
        dishValue.ingredients.length > MENU_LIMITS.ingredientsPerDish
      ) {
        errors[`${dishPath}.ingredients`] = [
          `A dish may contain at most ${MENU_LIMITS.ingredientsPerDish} ingredients.`,
        ];
      } else {
        dishValue.ingredients.forEach((ingredientValue, ingredientIndex) => {
          const ingredientPath = `${dishPath}.ingredients.${ingredientIndex}`;
          if (!isRecord(ingredientValue)) {
            errors[ingredientPath] = ['Ingredient must be an object.'];
            return;
          }

          const ingredientId = boundedId(
            ingredientValue.id,
            errors,
            `${ingredientPath}.id`,
          );
          if (ingredientId && ingredientIds.has(ingredientId)) {
            errors[`${ingredientPath}.id`] = ['Ingredient IDs must be unique.'];
          } else if (ingredientId) {
            ingredientIds.add(ingredientId);
          }
          const ingredientName = boundedText(
            ingredientValue.name,
            'Ingredient name',
            MENU_LIMITS.factBytes,
            errors,
            `${ingredientPath}.name`,
          );

          let quantity: string | null = null;
          let unit: ProcurementUnit | null = null;
          try {
            if (
              typeof ingredientValue.quantity !== 'string' &&
              typeof ingredientValue.quantity !== 'number'
            ) {
              throw new TypeError('Quantity must be a decimal string or integer.');
            }
            quantity = formatQuantity(
              parseQuantityToMilli(ingredientValue.quantity),
            );
          } catch {
            errors[`${ingredientPath}.quantity`] = [
              'Quantity must be positive, exact to at most three decimals, and within the supported range.',
            ];
          }
          try {
            unit = normalizeUnit(ingredientValue.unit as string);
          } catch {
            errors[`${ingredientPath}.unit`] = [
              'Use kg, g, L, ml, piece, pack, case, or crate.',
            ];
          }

          if (ingredientName && quantity && unit) {
            ingredients.push({
              ...(ingredientId ? { id: ingredientId } : {}),
              name: ingredientName,
              quantity,
              unit,
            });
          }
        });
      }

      if (dishName) {
        dishes.push({
          ...(id ? { id } : {}),
          name: dishName,
          ingredients,
        });
      }
    });
  }

  if (Object.keys(errors).length > 0 || !name) {
    throw new MenuValidationError(errors);
  }

  return {
    name,
    sourceText: normalizedSourceText,
    dishes,
  };
}

function validateActor(actor: MenuActor) {
  const errors: MenuErrors = {};
  const tenantId = boundedText(
    actor.tenantId,
    'Tenant ID',
    MENU_LIMITS.idBytes,
    errors,
    'tenantId',
  );
  const userId = boundedText(
    actor.userId,
    'User ID',
    MENU_LIMITS.idBytes,
    errors,
    'userId',
  );
  if (!tenantId || !userId || Object.keys(errors).length > 0) {
    throw new AuthorizationError();
  }
  return { tenantId, userId };
}

function validateMenuId(menuId: string) {
  const errors: MenuErrors = {};
  const id = boundedText(
    menuId,
    'Menu ID',
    MENU_LIMITS.idBytes,
    errors,
    'menuId',
  );
  if (!id) throw new MenuNotFoundError();
  return id;
}

function validateExpectedVersion(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new MenuValidationError({
      expectedVersion: ['Expected version must be a positive integer.'],
    });
  }
  return value as number;
}

async function requireActiveActor(
  transaction: Prisma.TransactionClient,
  actor: MenuActor,
) {
  const current = await transaction.user.findFirst({
    where: {
      id: actor.userId,
      tenantId: actor.tenantId,
      isActive: true,
      tenant: { isActive: true },
    },
    select: { id: true },
  });
  if (!current) throw new AuthorizationError();
}

async function purgeExpiredMenuSourceText(
  transaction: Prisma.TransactionClient,
  tenantId: string,
) {
  const cutoff = new Date(
    Date.now() - MENU_SOURCE_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
  await transaction.$executeRaw`
    UPDATE "Menu"
    SET "sourceText" = NULL
    WHERE "tenantId" = ${tenantId}
      AND "status" = 'DRAFT'::"MenuStatus"
      AND "sourceText" IS NOT NULL
      AND "updatedAt" < ${cutoff}
  `;
}

async function lockExpectedMenuVersion(
  transaction: Prisma.TransactionClient,
  input: { tenantId: string; menuId: string; expectedVersion: number },
) {
  const rows = await transaction.$queryRaw<
    Array<{ id: string; version: number }>
  >`
    SELECT "id", "version"
    FROM "Menu"
    WHERE "tenantId" = ${input.tenantId}
      AND "id" = ${input.menuId}
    FOR UPDATE
  `;
  const locked = rows[0];
  if (!locked) throw new MenuNotFoundError();
  if (locked.version !== input.expectedVersion) {
    throw new MenuConflictError(
      'This menu changed after you opened it. Reload before continuing.',
    );
  }
}

function createRecipes(tenantId: string, dishes: ValidDish[]) {
  return dishes.map((dish, dishPosition) => ({
    name: dish.name,
    position: dishPosition,
    tenant: { connect: { id: tenantId } },
    ingredients: {
      create: dish.ingredients.map((ingredient, ingredientPosition) => ({
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        position: ingredientPosition,
        tenant: { connect: { id: tenantId } },
      })),
    },
  }));
}

export async function createReviewedMenuDraft(
  input: { actor: MenuActor; draft: unknown },
  client: MenuClient = prisma,
) {
  const actor = validateActor(input.actor);
  const draft = validateMenuDraftInput(input.draft);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      await purgeExpiredMenuSourceText(transaction, actor.tenantId);
      return transaction.menu.create({
        data: {
          name: draft.name,
          sourceText: draft.sourceText,
          status: 'DRAFT',
          tenant: { connect: { id: actor.tenantId } },
          createdBy: {
            connect: {
              tenantId_id: { tenantId: actor.tenantId, id: actor.userId },
            },
          },
          recipes: { create: createRecipes(actor.tenantId, draft.dishes) },
        },
        include: menuInclude,
      });
    },
    client,
  );
}

export async function createDeterministicMenuDraft(
  input: {
    actor: MenuActor;
    menuText: string;
    name?: string;
  },
  client: MenuClient = prisma,
) {
  const boundedInput = validateMenuDraftInput({
    name: input.name ?? 'Menu draft',
    sourceText: input.menuText,
    dishes: [],
  });
  let dishes;
  try {
    dishes = buildDeterministicMenuDraft(boundedInput.sourceText!);
  } catch (error) {
    if (error instanceof DeterministicMenuDraftError) {
      throw new MenuValidationError({ menuText: [error.message] });
    }
    throw error;
  }
  return createReviewedMenuDraft(
    {
      actor: input.actor,
      draft: {
        name: boundedInput.name,
        sourceText: boundedInput.sourceText,
        dishes,
      },
    },
    client,
  );
}

export async function listReviewedMenus(
  input: {
    actor: MenuActor;
    cursor?: string;
    limit?: number;
  },
  client: MenuClient = prisma,
) {
  const actor = validateActor(input.actor);
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > MENU_LIMITS.listPage) {
    throw new MenuValidationError({
      limit: [`Limit must be between 1 and ${MENU_LIMITS.listPage}.`],
    });
  }
  const cursor = input.cursor ? validateMenuId(input.cursor) : undefined;

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      await purgeExpiredMenuSourceText(transaction, actor.tenantId);
      const menus = await transaction.menu.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor
          ? {
              cursor: {
                tenantId_id: { tenantId: actor.tenantId, id: cursor },
              },
              skip: 1,
            }
          : {}),
        select: {
          id: true,
          tenantId: true,
          name: true,
          status: true,
          version: true,
          approvedAt: true,
          approvedByUserId: true,
          createdByUserId: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              recipes: true,
              requests: true,
            },
          },
        },
      });
      const hasMore = menus.length > limit;
      if (hasMore) menus.pop();
      return {
        menus,
        nextCursor: hasMore ? menus.at(-1)?.id ?? null : null,
      };
    },
    client,
  );
}

export async function getReviewedMenu(
  input: { actor: MenuActor; menuId: string },
  client: MenuClient = prisma,
) {
  const actor = validateActor(input.actor);
  const menuId = validateMenuId(input.menuId);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      await purgeExpiredMenuSourceText(transaction, actor.tenantId);
      const menu = await transaction.menu.findFirst({
        where: { tenantId: actor.tenantId, id: menuId },
        include: menuInclude,
      });
      if (!menu) throw new MenuNotFoundError();
      return menu;
    },
    client,
  );
}

async function replaceMenuFacts(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  existing: Prisma.MenuGetPayload<{ include: typeof menuInclude }>,
) {
  await transaction.recipe.deleteMany({
    where: { tenantId, menuId: existing.id },
  });
}

export async function updateReviewedMenuDraft(
  input: {
    actor: MenuActor;
    menuId: string;
    expectedVersion: unknown;
    draft: unknown;
  },
  client: MenuClient = prisma,
) {
  const actor = validateActor(input.actor);
  const menuId = validateMenuId(input.menuId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);
  const draft = validateMenuDraftInput(input.draft);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      await purgeExpiredMenuSourceText(transaction, actor.tenantId);
      await lockExpectedMenuVersion(transaction, {
        tenantId: actor.tenantId,
        menuId,
        expectedVersion,
      });
      const existing = await transaction.menu.findFirst({
        where: { tenantId: actor.tenantId, id: menuId },
        include: menuInclude,
      });
      if (!existing) throw new MenuNotFoundError();

      await replaceMenuFacts(transaction, actor.tenantId, existing);
      return transaction.menu.update({
        where: {
          tenantId_id: { tenantId: actor.tenantId, id: existing.id },
        },
        data: {
          name: draft.name,
          sourceText: draft.sourceText,
          status: 'DRAFT',
          version: { increment: 1 },
          approvedAt: null,
          approvedByUserId: null,
          recipes: {
            create: createRecipes(actor.tenantId, draft.dishes),
          },
        },
        include: menuInclude,
      });
    },
    client,
  );
}

export async function approveReviewedMenu(
  input: { actor: MenuActor; menuId: string; expectedVersion: unknown },
  client: MenuClient = prisma,
) {
  const actor = validateActor(input.actor);
  const menuId = validateMenuId(input.menuId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      await requireActiveActor(transaction, actor);
      await purgeExpiredMenuSourceText(transaction, actor.tenantId);
      await lockExpectedMenuVersion(transaction, {
        tenantId: actor.tenantId,
        menuId,
        expectedVersion,
      });
      const existing = await transaction.menu.findFirst({
        where: { tenantId: actor.tenantId, id: menuId },
        include: menuInclude,
      });
      if (!existing) throw new MenuNotFoundError();
      if (existing.status === 'APPROVED') {
        throw new MenuConflictError('This menu version is already approved.');
      }
      if (
        existing.recipes.length === 0 ||
        existing.recipes.some(({ ingredients }) => ingredients.length === 0)
      ) {
        throw new MenuConflictError(
          'Review every dish and add at least one complete ingredient before approval.',
        );
      }

      const approvedAt = new Date();
      const menu = await transaction.menu.update({
        where: {
          tenantId_id: { tenantId: actor.tenantId, id: existing.id },
        },
        data: {
          status: 'APPROVED',
          approvedAt,
          sourceText: null,
          version: { increment: 1 },
          approvedBy: {
            connect: {
              tenantId_id: { tenantId: actor.tenantId, id: actor.userId },
            },
          },
        },
        include: menuInclude,
      });
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'menu.approved',
        entityId: existing.id,
        metadata: { version: menu.version },
      });
      return menu;
    },
    client,
  );
}
