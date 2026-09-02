import { readFileSync } from 'node:fs';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';

import {
  copyInvitationLink,
  InvitationReady,
  InviteMemberDialog,
  SettingsWorkspace,
  type WorkspaceSettingsData,
} from '@/components/settings/SettingsWorkspace';

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));

const ownerSettings: WorkspaceSettingsData = {
  workspace: {
    name: 'Monsoon Table',
    addressLine: '12 Hill Road', city: 'Mumbai', state: 'Maharashtra', pin: '400050',
    phone: '9876543210', gstin: '27AAPFU0939F1ZV', timezone: 'Asia/Kolkata',
  },
  currentUser: { id: 'owner-a', name: 'Ananya Mehta', email: 'owner@monsoontable.in', role: 'OWNER' },
  permissions: { canManageWorkspace: true, canManageMembers: true },
  members: [
    { id: 'owner-a', name: 'Ananya Mehta', email: 'owner@monsoontable.in', role: 'OWNER', joinedAt: '2026-01-02T00:00:00.000Z', lastLoginAt: '2026-08-28T08:15:00.000Z', isCurrentUser: true },
    { id: 'member-a', name: 'Ravi Kumar', email: 'ravi@monsoontable.in', role: 'MEMBER', joinedAt: '2026-03-04T00:00:00.000Z', lastLoginAt: null, isCurrentUser: false },
  ],
  pendingInvitations: [
    { id: 'invite-a', email: 'chef@monsoontable.in', role: 'MEMBER', expiresAt: '2026-09-04T12:00:00.000Z', createdAt: '2026-08-28T12:00:00.000Z', invitedByName: 'Ananya Mehta' },
  ],
};

describe('settings workspace UI', () => {
  it('renders a professional owner workspace with real restaurant and people controls', () => {
    const html = renderToStaticMarkup(<SettingsWorkspace initialData={ownerSettings} />);

    expect(html).toContain('Your restaurant');
    expect(html).toContain('Restaurant settings');
    expect(html).toContain('Update restaurant details, team access, and workspace preferences.');
    expect(html).toContain('Monsoon Table');
    expect(html).toContain('GSTIN');
    expect(html).toContain('People and access');
    expect(html).toContain('Ananya Mehta');
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('Pending invitation');
    expect(html).toContain('chef@monsoontable.in');
    expect(html).toContain('Invite someone');
    expect(html).toContain('Deactivate');
    expect(html).toContain('Save restaurant details');
    expect(html).toContain('Your account email belongs to you');
    expect(html).not.toContain('Contact email');
    expect(html).not.toMatch(/tenant-a|tokenDigest|passwordHash|billing|card details|pricing/i);
  });

  it('renders the same safe settings read-only for a member with a clear explanation', () => {
    const memberSettings: WorkspaceSettingsData = {
      ...ownerSettings,
      currentUser: { id: 'member-a', name: 'Ravi Kumar', email: 'ravi@monsoontable.in', role: 'MEMBER' },
      permissions: { canManageWorkspace: false, canManageMembers: false },
      members: ownerSettings.members.map((entry) => ({ ...entry, isCurrentUser: entry.id === 'member-a' })),
    };
    const html = renderToStaticMarkup(<SettingsWorkspace initialData={memberSettings} />);

    expect(html).toContain('View access only');
    expect(html).toContain('Only workspace owners can change restaurant details or manage access.');
    expect(html).not.toContain('Invite someone');
    expect(html).not.toContain('Deactivate');
    expect(html).not.toContain('Save restaurant details');
  });

  it('uses a labelled modal dialog with simple language and no exposed invitation secret field', () => {
    const html = renderToStaticMarkup(
      <InviteMemberDialog onClose={jest.fn()} onCreated={jest.fn()} />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="invite-member-title"');
    expect(html).toContain('Invite a teammate');
    expect(html).toContain('Work email');
    expect(html).toContain('Member can prepare requests');
    expect(readFileSync(
      path.resolve(__dirname, '../../src/components/settings/SettingsWorkspace.tsx'),
      'utf8',
    )).toContain("workspaceMutationFetch('/api/members/invitations'");
    expect(html).not.toMatch(/tokenDigest|raw token|tenant ID/i);
  });

  it('shows the one-time join link for manual copying and handles a blocked clipboard', async () => {
    const link = `https://quoteplate.example/join#token=${'A'.repeat(43)}`;
    const html = renderToStaticMarkup(<InvitationReady link={link} onClose={jest.fn()} />);

    expect(html).toContain('Private join link');
    expect(html).toContain(link);
    expect(html).toContain('Copy invite link');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="status"');
    await expect(copyInvitationLink(link, jest.fn().mockRejectedValue(new Error('blocked'))))
      .resolves.toBe(false);
    await expect(copyInvitationLink(link, jest.fn().mockResolvedValue(undefined)))
      .resolves.toBe(true);
  });

  it('reassures only read-only settings load failures that saved records are unchanged', () => {
    const component = readFileSync(
      path.resolve(__dirname, '../../src/components/settings/SettingsWorkspace.tsx'),
      'utf8',
    );

    expect(component).toContain('Your saved restaurant records are unchanged.');
    expect(component).toContain("errorContext === 'load'");
  });

  it('uses the task-led browser title', () => {
    const page = readFileSync(
      path.resolve(__dirname, '../../src/app/(app)/settings/page.tsx'),
      'utf8',
    );

    expect(page).toContain("metadata = { title: 'Restaurant settings' };");
    expect(page).not.toContain('Restaurant settings · QuotePlate');
  });
});
