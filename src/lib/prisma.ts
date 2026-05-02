import { PrismaClient } from '@prisma/client';
import { getCurrentTenantId } from './tenant-context';

// Models that carry tenantId and should be automatically scoped per tenant
const TENANT_SCOPED = new Set(['Menu', 'RFP', 'ProcurementRun']);

function buildPrismaClient() {
    const base = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    // Row-level isolation: inject tenantId on reads and creates for scoped models.
    // Uses AsyncLocalStorage so tenantId flows automatically through the call stack
    // without needing to pass it to every Prisma call explicitly.
    return base.$extends({
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }: {
                    model: string;
                    operation: string;
                    args: Record<string, any>;
                    query: (args: any) => Promise<any>;
                }) {
                    const tenantId = getCurrentTenantId();

                    if (!tenantId || !TENANT_SCOPED.has(model)) {
                        return query(args);
                    }

                    const readOps = new Set(['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);
                    const writeOps = new Set(['create', 'createMany']);

                    if (readOps.has(operation)) {
                        args = { ...args, where: { ...args.where, tenantId } };
                    } else if (writeOps.has(operation)) {
                        if (operation === 'create') {
                            args = { ...args, data: { ...args.data, tenantId } };
                        }
                    }

                    return query(args);
                },
            },
        },
    });
}

type ExtendedPrismaClient = ReturnType<typeof buildPrismaClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient };

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? buildPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
