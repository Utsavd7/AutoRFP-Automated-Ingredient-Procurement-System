import { privateNoStoreResponse } from '@/lib/api/private-response';
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
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { resolveInvitationOrigin } from '@/lib/security/invitation-origin';
import {
  type PublicClientRateLimit,
  publicClientRateLimit,
} from '@/lib/security/public-client-rate-limit';

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
  clientRateLimit?: PublicClientRateLimit;
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

const invitationResponse = privateNoStoreResponse;

function mutationRejection(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected === 'CROSS_ORIGIN') {
    return invitationResponse(problemResponse(
      403,
      'Request not allowed',
      'Manage invitations from the QuotePlate workspace page.',
    ));
  }
  if (rejected === 'UNSUPPORTED_MEDIA_TYPE') {
    return invitationResponse(problemResponse(
      415,
      'Unsupported media type',
      'Send this request as application/json.',
    ));
  }
  return null;
}

function invitationAcceptMutationRejection(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected === 'CROSS_ORIGIN') {
    return invitationResponse(problemResponse(
      403,
      'Request not allowed',
      'Accept this invitation from the QuotePlate join page.',
    ));
  }
  if (rejected === 'UNSUPPORTED_MEDIA_TYPE') {
    return invitationResponse(problemResponse(
      415,
      'Unsupported media type',
      'Send this request as application/json.',
    ));
  }
  return null;
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
      if (authenticated.response) {
        return invitationResponse(authenticated.response);
      }
      const rejected = mutationRejection(request);
      if (rejected) return rejected;
      const parsed = await boundedJson(request);
      if (parsed.response) return invitationResponse(parsed.response);

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
        return invitationResponse(Response.json(
          {
            invitation: {
              id: invitation.id,
              email: invitation.email,
              role: invitation.role,
              expiresAt: invitation.expiresAt.toISOString(),
              link: new URL(
                `/join#token=${encodeURIComponent(invitation.token)}`,
                invitationBaseUrl,
              ).toString(),
            },
          },
          { status: 201 },
        ));
      } catch (error) {
        return invitationResponse(invitationProblem(error));
      }
    },

    async DELETE(request: Request) {
      const authenticated = await currentActor();
      if (authenticated.response) {
        return invitationResponse(authenticated.response);
      }
      const rejected = mutationRejection(request);
      if (rejected) return rejected;
      const parsed = await boundedJson(request);
      if (parsed.response) return invitationResponse(parsed.response);

      try {
        await dependencies.revoke(
          {
            actor: authenticated.actor,
            invitationId: parsed.body.invitationId,
          },
          undefined,
          dependencies.now(),
        );
        return invitationResponse(new Response(null, { status: 204 }));
      } catch (error) {
        return invitationResponse(invitationProblem(error));
      }
    },
  };
}

export function createInvitationAcceptHandler(
  dependencies: AcceptHandlerDependencies,
) {
  const clientRateLimit =
    dependencies.clientRateLimit ?? publicClientRateLimit('invitation-accept');
  return async function invitationAccept(request: Request) {
    const rejected = invitationAcceptMutationRejection(request);
    if (rejected) return rejected;
    const currentTime = dependencies.now();
    try {
      const attempt = await clientRateLimit({ request, now: currentTime });
      if (!attempt.allowed) {
        const response = problemResponse(
          429,
          'Too many attempts',
          'Wait before trying to accept another invitation.',
        );
        response.headers.set('retry-after', String(attempt.retryAfterSeconds));
        return invitationResponse(response);
      }
    } catch (error) {
      return invitationResponse(invitationProblem(error));
    }

    const parsed = await boundedJson(request);
    if (parsed.response) return invitationResponse(parsed.response);

    try {
      await dependencies.accept(
        {
          token: parsed.body.token,
          email: parsed.body.email,
          name: parsed.body.name,
          password: parsed.body.password,
        },
        undefined,
        currentTime,
      );
      return invitationResponse(Response.json({ ok: true }, { status: 201 }));
    } catch (error) {
      return invitationResponse(invitationProblem(error));
    }
  };
}
