import * as Sentry from '@sentry/nextjs';
import {
    filterInvitationTelemetry,
    shouldSampleInvitationTrace,
} from './src/lib/security/invitation-telemetry';

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampler(context) {
        return shouldSampleInvitationTrace(context) ? 0.2 : 0;
    },
    beforeSend(event) {
        return filterInvitationTelemetry(event);
    },
    beforeSendTransaction(event) {
        return filterInvitationTelemetry(event);
    },
    beforeBreadcrumb(breadcrumb) {
        return filterInvitationTelemetry(breadcrumb);
    },
});
