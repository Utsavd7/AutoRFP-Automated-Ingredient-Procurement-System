import { AsyncLocalStorage } from 'async_hooks';

export const tenantStorage = new AsyncLocalStorage<string>();

export function withTenantContext<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return tenantStorage.run(tenantId, fn);
}

export function getCurrentTenantId(): string | undefined {
    return tenantStorage.getStore();
}
