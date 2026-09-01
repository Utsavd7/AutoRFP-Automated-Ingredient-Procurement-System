import { Prisma } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import {
  buildDeterministicMenuDraft,
  buildIngredientSuggestions,
  DeterministicMenuDraftError,
  MenuDocumentValidationError,
  proposeMenuCleanup,
  validateMenuDocument,
  type ApprovedMenuEvidence,
  type MenuDocumentV1,
} from '@/lib/menu/menu-document';
import { MENU_TEXT_BYTES } from '@/lib/menu/menu-input';
import { prisma } from '@/lib/prisma';

export const MENU_LIMITS = {
  nameBytes: 160,
  sourceBytes: MENU_TEXT_BYTES,
  idBytes: 200,
  listPage: 50,
} as const;

export const MENU_SOURCE_RETENTION_DAYS = 30;
const MENU_SOURCE_RETENTION_BATCH = 100;

type MenuClient = TenantTransactionHost;

type MenuActor = {
  tenantId: string;
  userId: string;
};

export type ValidMenuDraft = {
  name: string;
  sourceText: string | null;
  document: MenuDocumentV1;
};

type MenuErrors = Record<string, string[]>;

const menuSummarySelect = {
  id: true,
  name: true,
  status: true,
  version: true,
  approvedAt: true,
  approvedByUserId: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MenuSelect;

const menuDetailSelect = {
  ...menuSummarySelect,
  tenantId: true,
  document: true,
  sourceText: true,
} satisfies Prisma.MenuSelect;

type MenuDetail = Prisma.MenuGetPayload<{ select: typeof menuDetailSelect }>;
type ValidatedMenuDetail = Omit<MenuDetail, 'document'> & {
  document: MenuDocumentV1;
};

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
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedText(
  value: unknown,
  label: string,
  maximumBytes: number,
  errors: MenuErrors,
  path: string,
): string | null {
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

function normalizedSourceText(value: unknown, errors: MenuErrors): string | null {
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
  if (!isRecord(input)) {
    throw new MenuValidationError({ body: ['Expected a JSON object.'] });
  }

  const allowedKeys = new Set([
    'name',
    'sourceText',
    'document',
    'expectedVersion',
  ]);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw new MenuValidationError({
      [unknownKey]: [`Unknown menu field ${unknownKey}.`],
    });
  }

  const errors: MenuErrors = {};
  const name = boundedText(
    input.name,
    'Menu name',
    MENU_LIMITS.nameBytes,
    errors,
    'name',
  );
  const sourceText = normalizedSourceText(input.sourceText, errors);
  let document: MenuDocumentV1 | null = null;
  try {
    document = validateMenuDocument(input.document);
  } catch (error) {
    errors.document = [
      error instanceof Error ? error.message : 'Menu document is invalid.',
    ];
  }

  if (!name || !document || Object.keys(errors).length > 0) {
    throw new MenuValidationError(errors);
  }
  return { name, sourceText, document };
}

function validateActor(actor: MenuActor): MenuActor {
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

function validateMenuId(menuId: string): string {
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

function validateExpectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new MenuValidationError({
      expectedVersion: ['Expected version must be a positive integer.'],
    });
  }
  return value as number;
}

function prismaDocument(document: MenuDocumentV1): Prisma.InputJsonValue {
  return document as unknown as Prisma.InputJsonValue;
}

function storedDocument(value: Prisma.JsonValue): MenuDocumentV1 {
  try {
    return validateMenuDocument(value);
  } catch (error) {
    throw new MenuValidationError({
      document: [
        error instanceof Error
          ? error.message
          : 'The stored menu document is invalid.',
      ],
    });
  }
}

async function purgeExpiredMenuSourceText(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  const cutoff = new Date(
    Date.now() - MENU_SOURCE_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
  await transaction.$executeRaw`
    WITH expired AS (
      SELECT "id"
      FROM "Menu"
      WHERE "tenantId" = ${tenantId}
        AND "status" = 'DRAFT'::"MenuStatus"
        AND "sourceText" IS NOT NULL
        AND "updatedAt" < ${cutoff}
      ORDER BY "updatedAt" ASC, "id" ASC
      LIMIT ${MENU_SOURCE_RETENTION_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "Menu" AS menu
    SET "sourceText" = NULL
    FROM expired
    WHERE menu."tenantId" = ${tenantId}
      AND menu."id" = expired."id"
  `;
}

async function findMenuAfterMutation(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  menuId: string,
): Promise<ValidatedMenuDetail> {
  const menu = await transaction.menu.findFirst({
    where: { tenantId, id: menuId },
    select: menuDetailSelect,
  });
  if (!menu) throw new MenuNotFoundError();
  return { ...menu, document: storedDocument(menu.document) };
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
      await purgeExpiredMenuSourceText(transaction, actor.tenantId);
      const menu = await transaction.menu.create({
        data: {
          name: draft.name,
          sourceText: draft.sourceText,
          status: 'DRAFT',
          document: prismaDocument(draft.document),
          tenantId: actor.tenantId,
          createdByUserId: actor.userId,
        },
        select: menuDetailSelect,
      });
      return { ...menu, document: storedDocument(menu.document) };
    },
    client,
  );
}

export async function createDeterministicMenuDraft(
  input: {
    actor: MenuActor;
    menuText: string;
    name?: string;
    source?: MenuDocumentV1['source'];
  },
  client: MenuClient = prisma,
) {
  const errors: MenuErrors = {};
  const sourceText = normalizedSourceText(input.menuText, errors);
  const name = boundedText(
    input.name ?? 'Menu draft',
    'Menu name',
    MENU_LIMITS.nameBytes,
    errors,
    'name',
  );
  if (!sourceText || !name || Object.keys(errors).length > 0) {
    throw new MenuValidationError(errors);
  }

  let dishes: MenuDocumentV1['dishes'];
  try {
    dishes = buildDeterministicMenuDraft(sourceText);
  } catch (error) {
    if (error instanceof DeterministicMenuDraftError) {
      throw new MenuValidationError({ menuText: [error.message] });
    }
    throw error;
  }

  const document: MenuDocumentV1 = {
    v: 1,
    source: input.source ?? {
      kind: 'PASTE',
      canonicalUrl: null,
      permissionConfirmed: false,
    },
    dishes,
  };
  return createReviewedMenuDraft(
    { actor: input.actor, draft: { name, sourceText, document } },
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
        select: menuSummarySelect,
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
      const menu = await transaction.menu.findFirst({
        where: { tenantId: actor.tenantId, id: menuId },
        select: menuDetailSelect,
      });
      if (!menu) throw new MenuNotFoundError();
      const document = storedDocument(menu.document);

      const approvedRows = await transaction.menu.findMany({
        where: {
          tenantId: actor.tenantId,
          status: 'APPROVED',
          id: { not: menuId },
        },
        orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
        take: 8,
        select: { name: true, document: true },
      });
      const approvedEvidence: ApprovedMenuEvidence[] = [];
      for (const approved of approvedRows) {
        try {
          approvedEvidence.push({
            menuName: approved.name,
            document: validateMenuDocument(approved.document),
          });
        } catch (error) {
          if (!(error instanceof MenuDocumentValidationError)) throw error;
        }
      }

      const { proposals } = proposeMenuCleanup(document);
      return {
        ...menu,
        document,
        cleanupProposals: proposals,
        ingredientSuggestionsByDishId: buildIngredientSuggestions(
          document,
          approvedEvidence,
        ),
      };
    },
    client,
  );
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
      await purgeExpiredMenuSourceText(transaction, actor.tenantId);
      const existing = await transaction.menu.findFirst({
        where: { tenantId: actor.tenantId, id: menuId },
        select: { id: true, version: true },
      });
      if (!existing) throw new MenuNotFoundError();
      if (existing.version !== expectedVersion) {
        throw new MenuConflictError(
          'This menu changed after you opened it. Reload before continuing.',
        );
      }

      const updated = await transaction.menu.updateMany({
        where: {
          tenantId: actor.tenantId,
          id: menuId,
          version: expectedVersion,
        },
        data: {
          name: draft.name,
          sourceText: draft.sourceText,
          document: prismaDocument(draft.document),
          status: 'DRAFT',
          version: { increment: 1 },
          approvedAt: null,
          approvedByUserId: null,
        },
      });
      if (updated.count !== 1) {
        throw new MenuConflictError(
          'This menu changed after you opened it. Reload before continuing.',
        );
      }
      return findMenuAfterMutation(transaction, actor.tenantId, menuId);
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
      await purgeExpiredMenuSourceText(transaction, actor.tenantId);
      const existing = await transaction.menu.findFirst({
        where: { tenantId: actor.tenantId, id: menuId },
        select: { id: true, status: true, version: true, document: true },
      });
      if (!existing) throw new MenuNotFoundError();
      if (existing.version !== expectedVersion) {
        throw new MenuConflictError(
          'This menu changed after you opened it. Reload before continuing.',
        );
      }
      if (existing.status === 'APPROVED') {
        throw new MenuConflictError('This menu version is already approved.');
      }

      const document = storedDocument(existing.document);
      if (
        document.dishes.length === 0 ||
        document.dishes.some(({ ingredients }) => ingredients.length === 0)
      ) {
        throw new MenuConflictError(
          'Review every dish and add at least one complete ingredient before approval.',
        );
      }

      const approvedAt = new Date();
      const updated = await transaction.menu.updateMany({
        where: {
          tenantId: actor.tenantId,
          id: menuId,
          version: expectedVersion,
          status: 'DRAFT',
        },
        data: {
          status: 'APPROVED',
          approvedAt,
          sourceText: null,
          version: { increment: 1 },
          approvedByUserId: actor.userId,
        },
      });
      if (updated.count !== 1) {
        throw new MenuConflictError(
          'This menu changed after you opened it. Reload before continuing.',
        );
      }

      const menu = await findMenuAfterMutation(
        transaction,
        actor.tenantId,
        menuId,
      );
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'menu.approved',
        entityId: menuId,
        metadata: { version: menu.version },
      });
      return menu;
    },
    client,
  );
}

export async function deleteReviewedMenu(
  input: { actor: MenuActor; menuId: string; expectedVersion: unknown },
  client: MenuClient = prisma,
) {
  const actor = validateActor(input.actor);
  const menuId = validateMenuId(input.menuId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);

  return withTenant(
    actor.tenantId,
    async (transaction) => {
      const existing = await transaction.menu.findFirst({
        where: { tenantId: actor.tenantId, id: menuId },
        select: { id: true, version: true },
      });
      if (!existing) throw new MenuNotFoundError();
      if (existing.version !== expectedVersion) {
        throw new MenuConflictError(
          'This menu changed after you opened it. Reload before continuing.',
        );
      }

      const procurementRequestCount = await transaction.procurementRequest.count({
        where: { tenantId: actor.tenantId, menuId },
      });
      if (procurementRequestCount > 0) {
        throw new MenuConflictError(
          'This menu has procurement history and cannot be deleted.',
        );
      }

      const deleted = await transaction.menu.deleteMany({
        where: {
          tenantId: actor.tenantId,
          id: menuId,
          version: expectedVersion,
        },
      });
      if (deleted.count !== 1) {
        throw new MenuConflictError(
          'This menu changed after you opened it. Reload before continuing.',
        );
      }

      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'menu.deleted',
        entityId: menuId,
        metadata: { version: expectedVersion },
      });
      return { id: menuId };
    },
    client,
  );
}
