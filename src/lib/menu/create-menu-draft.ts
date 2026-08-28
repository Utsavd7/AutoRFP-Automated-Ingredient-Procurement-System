import type { PrismaClient } from '@prisma/client';

import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import { buildDeterministicMenuDraft } from '@/lib/menu/deterministic-draft';
import { prisma } from '@/lib/prisma';

type MenuClient = Pick<PrismaClient, '$transaction'> & TenantTransactionHost;

export async function createMenuDraft(
  input: { tenantId: string; menuText: string },
  client: MenuClient = prisma,
) {
  const dishes = buildDeterministicMenuDraft(input.menuText);
  return withTenant(
    input.tenantId,
    (transaction) =>
      transaction.menu.create({
        data: {
          tenantId: input.tenantId,
          name: 'Menu draft',
          sourceText: input.menuText,
          status: 'DRAFT',
          recipes: {
            create: dishes.map((dish, position) => ({
              name: dish.name,
              position,
              tenant: { connect: { id: input.tenantId } },
              ingredients: { create: [] },
            })),
          },
        },
        include: { recipes: { include: { ingredients: true } } },
      }),
    client,
  );
}
