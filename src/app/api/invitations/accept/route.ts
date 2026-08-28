import { createInvitationAcceptHandler } from '@/lib/members/invitation-handlers';
import { acceptInvitation } from '@/lib/members/invitations';

export const POST = createInvitationAcceptHandler({
  accept: acceptInvitation,
  now: () => new Date(),
});
