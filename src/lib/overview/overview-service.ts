import { type Prisma, type PrismaClient } from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import { withTenant } from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';

const OVERVIEW_LIST_LIMIT = 5;
const ACTOR_ID_BYTES = 200;

export type OverviewActor = { tenantId: string; userId: string };

export type OverviewData = {
  generatedAt: string;
  counts: {
    activeSuppliers: number;
    menus: { draft: number; approved: number };
    requests: { draft: number; open: number; awarded: number };
    quotesReceivedForOpenRequests: number;
  };
  deadlines: Array<{
    requestId: string;
    title: string;
    quoteDeadline: string;
    suppliersInvited: number;
    quotesReceived: number;
  }>;
  recentAwards: Array<{
    awardId: string;
    requestId: string;
    title: string;
    totalPaise: string;
    awardedAt: string;
  }>;
};

type OverviewDependencies = {
  transact: <T>(
    tenantId: string,
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  now: () => Date;
};

type OverviewClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

function validActorId(value: string) {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= ACTOR_ID_BYTES &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function requireValidActor(actor: OverviewActor) {
  if (!validActorId(actor.tenantId) || !validActorId(actor.userId)) {
    throw new AuthorizationError();
  }
  return actor;
}

async function requireActiveActor(
  transaction: Prisma.TransactionClient,
  actor: OverviewActor,
) {
  const active = await transaction.user.findFirst({
    where: {
      id: actor.userId,
      tenantId: actor.tenantId,
      isActive: true,
      tenant: { isActive: true },
    },
    select: { id: true },
  });
  if (!active) throw new AuthorizationError();
}

function groupedCount(
  groups: Array<{ status: string; _count: { _all: number } }>,
  status: string,
) {
  return groups.find((group) => group.status === status)?._count._all ?? 0;
}

const defaultDependencies: OverviewDependencies = {
  transact: (tenantId, callback) => withTenant(tenantId, callback, prisma),
  now: () => new Date(),
};

export function createOverviewOperations(
  dependencies: OverviewDependencies = defaultDependencies,
) {
  return {
    async load(input: { actor: OverviewActor }): Promise<OverviewData> {
      const actor = requireValidActor(input.actor);
      return dependencies.transact(actor.tenantId, async (transaction) => {
        await requireActiveActor(transaction, actor);

        const [
          activeSuppliers,
          menuGroups,
          requestGroups,
          quotesReceivedForOpenRequests,
          deadlines,
          recentAwards,
        ] = await Promise.all([
          transaction.supplier.count({
            where: { tenantId: actor.tenantId, isActive: true },
          }),
          transaction.menu.groupBy({
            by: ['status'],
            where: { tenantId: actor.tenantId },
            _count: { _all: true },
          }),
          transaction.procurementRequest.groupBy({
            by: ['status'],
            where: {
              tenantId: actor.tenantId,
              status: { in: ['DRAFT', 'OPEN', 'AWARDED'] },
            },
            _count: { _all: true },
          }),
          transaction.supplierRequest.count({
            where: {
              tenantId: actor.tenantId,
              request: { tenantId: actor.tenantId, status: 'OPEN' },
              quotes: { some: { tenantId: actor.tenantId } },
            },
          }),
          transaction.procurementRequest.findMany({
            where: { tenantId: actor.tenantId, status: 'OPEN' },
            orderBy: [{ quoteDeadline: 'asc' }, { id: 'asc' }],
            take: OVERVIEW_LIST_LIMIT,
            select: {
              id: true,
              title: true,
              quoteDeadline: true,
              _count: { select: { supplierRequests: true } },
            },
          }),
          transaction.award.findMany({
            where: { tenantId: actor.tenantId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: OVERVIEW_LIST_LIMIT,
            select: {
              id: true,
              requestId: true,
              totalPaise: true,
              createdAt: true,
              request: { select: { title: true } },
            },
          }),
        ]);

        const responseGroups = deadlines.length
          ? await transaction.supplierRequest.groupBy({
              by: ['requestId'],
              where: {
                tenantId: actor.tenantId,
                requestId: { in: deadlines.map(({ id }) => id) },
                quotes: { some: { tenantId: actor.tenantId } },
              },
              _count: { _all: true },
            })
          : [];
        const responsesByRequest = new Map(
          responseGroups.map((group) => [group.requestId, group._count._all]),
        );

        return {
          generatedAt: dependencies.now().toISOString(),
          counts: {
            activeSuppliers,
            menus: {
              draft: groupedCount(menuGroups, 'DRAFT'),
              approved: groupedCount(menuGroups, 'APPROVED'),
            },
            requests: {
              draft: groupedCount(requestGroups, 'DRAFT'),
              open: groupedCount(requestGroups, 'OPEN'),
              awarded: groupedCount(requestGroups, 'AWARDED'),
            },
            quotesReceivedForOpenRequests,
          },
          deadlines: deadlines.map((request) => ({
            requestId: request.id,
            title: request.title,
            quoteDeadline: request.quoteDeadline.toISOString(),
            suppliersInvited: request._count.supplierRequests,
            quotesReceived: responsesByRequest.get(request.id) ?? 0,
          })),
          recentAwards: recentAwards.map((award) => ({
            awardId: award.id,
            requestId: award.requestId,
            title: award.request.title,
            totalPaise: award.totalPaise.toString(),
            awardedAt: award.createdAt.toISOString(),
          })),
        };
      });
    },
  };
}

export function createPrismaOverviewOperations(client: OverviewClient) {
  return createOverviewOperations({
    transact: (tenantId, callback) => withTenant(tenantId, callback, client),
    now: () => new Date(),
  });
}

const overviewOperations = createOverviewOperations();

export function getOverview(input: { actor: OverviewActor }) {
  return overviewOperations.load(input);
}
