import { inngest } from './client';
import { prisma } from '@/lib/prisma';

// Background job: refresh market pricing for all known ingredients (daily at 6am ET)
export const refreshPricingTrends = inngest.createFunction(
    {
        id: 'refresh-pricing-trends',
        name: 'Daily Pricing Refresh',
        triggers: [{ cron: 'TZ=America/New_York 0 6 * * *' }],
    },
    async ({ logger }: { logger: any }) => {
        const ingredients = await prisma.ingredient.findMany({ select: { id: true, name: true } });
        logger.info(`Refreshing pricing for ${ingredients.length} ingredients`);
        let refreshed = 0;
        for (const ing of ingredients.slice(0, 50)) {
            try {
                const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/pricing?ingredient=${encodeURIComponent(ing.name)}`);
                if (res.ok) refreshed++;
            } catch { /* non-critical */ }
        }
        logger.info(`Refreshed ${refreshed} ingredients`);
        return { refreshed, total: ingredients.length };
    }
);

// Background job: mark RFP emails as sent with automatic retry (fires on "rfp/send" event)
export const sendRFPJob = inngest.createFunction(
    {
        id: 'send-rfp-emails',
        name: 'Send RFP Emails',
        retries: 3,
        triggers: [{ event: 'rfp/send' }],
    },
    async ({ event, step, logger }: { event: any; step: any; logger: any }) => {
        const { menuId, rfpIds } = event.data as { menuId: string; rfpIds: string[] };
        logger.info(`Sending RFPs for menu ${menuId} to ${rfpIds.length} vendors`);

        const results = await Promise.allSettled(
            rfpIds.map((rfpId: string) =>
                step.run(`mark-sent-${rfpId}`, async () => {
                    await prisma.rFP.update({
                        where: { id: rfpId },
                        data: { status: 'SENT', sentAt: new Date() },
                    });
                    return { rfpId, ok: true };
                })
            )
        );

        const sent = results.filter((r: any) => r.status === 'fulfilled').length;
        logger.info(`Marked ${sent}/${rfpIds.length} RFPs as sent`);
        return { sent, total: rfpIds.length };
    }
);

// Background job: report on stale procurement runs (weekly on Sunday at 2am ET)
export const archiveOldRuns = inngest.createFunction(
    {
        id: 'archive-old-runs',
        name: 'Archive Old Procurement Runs',
        triggers: [{ cron: 'TZ=America/New_York 0 2 * * 0' }],
    },
    async ({ logger }: { logger: any }) => {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const count = await prisma.procurementRun.count({ where: { createdAt: { lt: cutoff } } });
        logger.info(`Found ${count} procurement runs older than 90 days`);
        return { eligible: count };
    }
);
