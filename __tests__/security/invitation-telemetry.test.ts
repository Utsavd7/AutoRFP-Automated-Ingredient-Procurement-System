import {
  filterInvitationTelemetry,
  shouldSampleInvitationTrace,
} from '@/lib/security/invitation-telemetry';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('invitation telemetry privacy', () => {
  const token = 'A'.repeat(43);

  it('drops errors, transactions, and breadcrumbs containing invitation secrets', () => {
    expect(
      filterInvitationTelemetry({
        request: { url: `https://app.quoteplate.example/join/${token}` },
      }),
    ).toBeNull();
    expect(
      filterInvitationTelemetry({
        category: 'fetch',
        data: { url: '/api/invitations/accept', token },
      }),
    ).toBeNull();
    expect(
      filterInvitationTelemetry({
        request: { url: '/api/invitations/accept' },
      }),
    ).toBeNull();
    expect(
      filterInvitationTelemetry({ message: `invite rejected: ${token}` }),
    ).toBeNull();
  });

  it('disables tracing for join and acceptance paths while preserving normal telemetry', () => {
    expect(
      shouldSampleInvitationTrace({
        name: `GET /join/${token}`,
        attributes: { 'http.url': `https://app.quoteplate.example/join/${token}` },
      }),
    ).toBe(false);
    expect(
      shouldSampleInvitationTrace({ name: 'POST /api/invitations/accept' }),
    ).toBe(false);

    const ordinary = { request: { url: '/dashboard' } };
    expect(filterInvitationTelemetry(ordinary)).toBe(ordinary);
    expect(shouldSampleInvitationTrace({ name: 'GET /dashboard' })).toBe(true);
  });

  it('wires the privacy filter into browser and server monitoring with replay off', () => {
    const root = path.resolve(__dirname, '../..');
    const client = readFileSync(path.join(root, 'sentry.client.config.ts'), 'utf8');
    const server = readFileSync(path.join(root, 'sentry.server.config.ts'), 'utf8');

    for (const config of [client, server]) {
      expect(config).toContain('filterInvitationTelemetry');
      expect(config).toContain('beforeSendTransaction');
      expect(config).toContain('beforeBreadcrumb');
      expect(config).toContain('tracesSampler');
    }
    expect(client).not.toContain('replayIntegration');
    expect(client).not.toContain('replaysSessionSampleRate');
    expect(client).not.toContain('replaysOnErrorSampleRate');
  });
});
