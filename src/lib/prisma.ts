import { PrismaClient } from '@prisma/client';
import { getCurrentTenantId } from './tenant-context';

// Models that carry tenantId and should be automatically scoped per tenant
const TENANT_SCOPED = new Set(['Menu', 'RFP', 'ProcurementRun']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
                async $allOperations({ model, operation, args, query }) {
                    const tenantId = getCurrentTenantId();

                    if (!tenantId || !TENANT_SCOPED.has(model)) {
                        return query(args);
                    }

                    const readOps = new Set(['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);
                    const writeOps = new Set(['create', 'createMany']);

                    if (readOps.has(operation)) {
                        const where = Reflect.get(args, 'where');
                        Object.assign(args, { where: { ...(isRecord(where) ? where : {}), tenantId } });
                    } else if (writeOps.has(operation)) {
                        if (operation === 'create') {
                            const data = Reflect.get(args, 'data');
                            Object.assign(args, { data: { ...(isRecord(data) ? data : {}), tenantId } });
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
