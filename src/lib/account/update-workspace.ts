import type { PrismaClient } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { AuthorizationError, requireOwner } from '@/lib/auth/guards';
import {
  withTenant,
  type TenantTransactionHost,
} from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';

type WorkspaceUpdate = {
  actor: { userId: string; tenantId: string };
  name: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  phone: string;
};

type WorkspaceClient = Pick<PrismaClient, '$transaction'> &
  TenantTransactionHost;

export async function updateWorkspaceAccount(
  input: WorkspaceUpdate,
  client: WorkspaceClient = prisma,
) {
  return withTenant(
    input.actor.tenantId,
    async (transaction) => {
      const actor = await transaction.user.findFirst({
        where: {
          id: input.actor.userId,
          tenantId: input.actor.tenantId,
          isActive: true,
          tenant: { isActive: true },
        },
        include: { tenant: true },
      });
      if (!actor) throw new AuthorizationError();
      requireOwner(actor, 'manage-settings');

      const fields = [
        actor.tenant.name !== input.name ? 'name' : null,
        actor.email !== input.email ? 'email' : null,
        actor.tenant.addressLine !== input.addressLine ? 'addressLine' : null,
        actor.tenant.city !== input.city ? 'city' : null,
        actor.tenant.state !== input.state ? 'state' : null,
        actor.tenant.pin !== input.pin ? 'pin' : null,
        actor.tenant.phone !== input.phone ? 'phone' : null,
      ].filter((field): field is string => field !== null);

      const tenant = await transaction.tenant.update({
        where: { id: actor.tenantId },
        data: {
          name: input.name,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state,
          pin: input.pin,
          phone: input.phone,
        },
      });
      const user = await transaction.user.update({
        where: { id: actor.id },
        data: { email: input.email },
      });
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.id,
        action: 'workspace.updated',
        entityId: actor.tenantId,
        metadata: { fields },
      });

      return { tenant, user };
    },
    client,
  );
}
