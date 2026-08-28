import { createMemberInvitationHandlers } from '@/lib/members/invitation-handlers';
import {
  createInvitation,
  revokeInvitation,
} from '@/lib/members/invitations';
import { requireAccountContext } from '@/lib/server-account';

const handlers = createMemberInvitationHandlers({
  accountContext: requireAccountContext,
  create: createInvitation,
  revoke: revokeInvitation,
  now: () => new Date(),
});

export const { POST, DELETE } = handlers;
