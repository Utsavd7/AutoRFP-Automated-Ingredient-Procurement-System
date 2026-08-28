import { problemResponse } from '@/lib/api/problem';
import {
  RequestBodyTooLargeError,
  readBoundedJson,
} from '@/lib/api/read-bounded-json';
import {
  InvitationError,
  acceptInvitation,
  createInvitation,
  revokeInvitation,
} from '@/lib/members/invitations';
import { requireAccountContext } from '@/lib/server-account';
import { resolveInvitationOrigin } from '@/lib/security/invitation-origin';

const MAX_INVITATION_BODY_BYTES = 16 * 1_024;

type AccountContext = Awaited<ReturnType<typeof requireAccountContext>>;

type MemberHandlerDependencies = {
  accountContext: () => Promise<AccountContext>;
  create: typeof createInvitation;
  revoke: typeof revokeInvitation;
  now: () => Date;
};

type AcceptHandlerDependencies = {
  accept: typeof acceptInvitation;
  now: () => Date;
};

async function boundedJson(request: Request) {
  try {
    const body = await readBoundedJson(request, MAX_INVITATION_BODY_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new TypeError('Expected a JSON object.');
    }
    return { body: body as Record<string, unknown>, response: null } as const;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { body: null, response: problemResponse(
        413,
        'Request too large',
        'Invitation details must be smaller than 16 KB.',
      ) } as const;
    }
    return { body: null, response: problemResponse(
      400,
      'Invalid request',
      'Provide a valid JSON object.',
    ) } as const;
  }
}

function publicInvitationResponse(response: Response) {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('referrer-policy', 'no-referrer');
  return response;
}

function invitationProblem(error: unknown) {
  if (error instanceof InvitationError) {
    const title =
      {
        403: 'Forbidden',
        410: 'Invitation unavailable',
        429: 'Too many attempts',
      }[error.status] ?? 'Invalid invitation';
    const response = problemResponse(error.status, title, error.message);
    if (
      error.status === 429 &&
      Number.isSafeInteger(error.retryAfterSeconds) &&
      (error.retryAfterSeconds ?? 0) > 0
    ) {
      response.headers.set('retry-after', String(error.retryAfterSeconds));
    }
    return response;
  }
  return problemResponse(
    503,
    'Invitation service unavailable',
    'Unable to manage invitations right now. Try again shortly.',
  );
}

export function createMemberInvitationHandlers(
  dependencies: MemberHandlerDependencies,
) {
  async function currentActor() {
    try {
      const context = await dependencies.accountContext();
      return context
        ? {
            actor: {
              userId: context.user.id,
              tenantId: context.tenant.id,
            },
            response: null,
          } as const
        : {
            actor: null,
            response: problemResponse(
              401,
              'Unauthorized',
              'Authentication is required.',
            ),
          } as const;
    } catch (error) {
      return { actor: null, response: invitationProblem(error) } as const;
    }
  }

  return {
    async POST(request: Request) {
      const authenticated = await currentActor();
      if (authenticated.response) return authenticated.response;
      const parsed = await boundedJson(request);
      if (parsed.response) return parsed.response;

      try {
        const invitationBaseUrl = resolveInvitationOrigin();
        const invitation = await dependencies.create(
          {
            actor: authenticated.actor,
            email: parsed.body.email,
            role: parsed.body.role,
          },
          undefined,
          dependencies.now(),
        );
        return Response.json(
          {
            invitation: {
              id: invitation.id,
              email: invitation.email,
              role: invitation.role,
              expiresAt: invitation.expiresAt.toISOString(),
              link: new URL(
                `/join/${encodeURIComponent(invitation.token)}`,
                invitationBaseUrl,
              ).toString(),
            },
          },
          { status: 201, headers: { 'cache-control': 'no-store' } },
        );
      } catch (error) {
        return invitationProblem(error);
      }
    },

    async DELETE(request: Request) {
      const authenticated = await currentActor();
      if (authenticated.response) return authenticated.response;
      const parsed = await boundedJson(request);
      if (parsed.response) return parsed.response;

      try {
        await dependencies.revoke(
          {
            actor: authenticated.actor,
            invitationId: parsed.body.invitationId,
          },
          undefined,
          dependencies.now(),
        );
        return new Response(null, { status: 204 });
      } catch (error) {
        return invitationProblem(error);
      }
    },
  };
}

export function createInvitationAcceptHandler(
  dependencies: AcceptHandlerDependencies,
) {
  return async function invitationAccept(request: Request) {
    const parsed = await boundedJson(request);
    if (parsed.response) return publicInvitationResponse(parsed.response);

    try {
      await dependencies.accept(
        {
          token: parsed.body.token,
          email: parsed.body.email,
          name: parsed.body.name,
          password: parsed.body.password,
        },
        undefined,
        dependencies.now(),
      );
      return publicInvitationResponse(Response.json({ ok: true }, { status: 201 }));
    } catch (error) {
      return publicInvitationResponse(invitationProblem(error));
    }
  };
}
