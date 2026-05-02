import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
    devIndicators: false,
};

export default withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG ?? 'autorfp',
    project: process.env.SENTRY_PROJECT ?? 'autorfp',
    silent: true,
    // Skip source map upload when no DSN is configured (local dev without Sentry account)
    sourcemaps: {
        disable: !process.env.NEXT_PUBLIC_SENTRY_DSN,
    },
});
