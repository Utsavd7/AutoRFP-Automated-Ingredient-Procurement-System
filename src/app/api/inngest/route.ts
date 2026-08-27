import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { sendRFPJob, refreshPricingTrends, archiveOldRuns } from '@/inngest/functions';
import { isLegacyFeatureEnabled, legacyFeatureUnavailable } from '@/lib/features/legacy-features';

const handlers = serve({
    client: inngest,
    functions: [sendRFPJob, refreshPricingTrends, archiveOldRuns],
});

export const GET = (...args: Parameters<typeof handlers.GET>) => {
    if (!isLegacyFeatureEnabled()) {
        return legacyFeatureUnavailable();
    }
    return handlers.GET(...args);
};

export const POST = (...args: Parameters<typeof handlers.POST>) => {
    if (!isLegacyFeatureEnabled()) {
        return legacyFeatureUnavailable();
    }
    return handlers.POST(...args);
};

export const PUT = (...args: Parameters<typeof handlers.PUT>) => {
    if (!isLegacyFeatureEnabled()) {
        return legacyFeatureUnavailable();
    }
    return handlers.PUT(...args);
};
