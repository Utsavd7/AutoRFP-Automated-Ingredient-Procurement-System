import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { sendRFPJob, refreshPricingTrends, archiveOldRuns } from '@/inngest/functions';

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [sendRFPJob, refreshPricingTrends, archiveOldRuns],
});
