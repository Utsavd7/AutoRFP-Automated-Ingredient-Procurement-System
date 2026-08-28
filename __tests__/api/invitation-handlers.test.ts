import {
  createInvitationAcceptHandler,
  createMemberInvitationHandlers,
} from '@/lib/members/invitation-handlers';
import { InvitationError } from '@/lib/members/invitations';

const context = {
  tenant: { id: 'tenant-a' },
  user: { id: 'owner-a' },
};

function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  options: { origin?: string; contentType?: string; length?: string } = {},
) {
  return new Request(url, {
    method,
    headers: {
      'content-type': options.contentType ?? 'application/json',
      origin: options.origin ?? new URL(url).origin,
      'sec-fetch-site': 'same-origin',
      ...(options.length ? { 'content-length': options.length } : {}),
    },
    body: JSON.stringify(body),
  });
}

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('member invitation route handlers', () => {
  it('requires a current account before creating or revoking invitations', async () => {
    const handlers = createMemberInvitationHandlers({
      accountContext: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      revoke: jest.fn(),
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });

    const createResponse = await handlers.POST(
      jsonRequest('https://quoteplate.example/api/members/invitations', 'POST', {
        email: 'member@example.com',
      }),
    );
    const revokeResponse = await handlers.DELETE(
      jsonRequest('https://quoteplate.example/api/members/invitations', 'DELETE', {
        invitationId: 'invite-a',
      }),
    );

    expect(createResponse.status).toBe(401);
    expect(revokeResponse.status).toBe(401);
    expectPrivate(createResponse);
    expectPrivate(revokeResponse);
  });

  it('returns one copyable same-origin join link without a separate raw token', async () => {
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = 'https://app.quoteplate.example';
    const create = jest.fn().mockResolvedValue({
      id: 'invite-a',
      token: 'A'.repeat(43),
      email: 'member@example.com',
      role: 'MEMBER',
      expiresAt: new Date('2026-09-04T10:00:00.000Z'),
    });
    const handlers = createMemberInvitationHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      create,
      revoke: jest.fn(),
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });

    let response: Response;
    try {
      response = await handlers.POST(
        jsonRequest('https://quoteplate.example/api/members/invitations', 'POST', {
          email: ' MEMBER@EXAMPLE.COM ',
          role: 'OWNER',
        }),
      );
    } finally {
      if (previousNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = previousNextAuthUrl;
    }
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      invitation: {
        id: 'invite-a',
        email: 'member@example.com',
        role: 'MEMBER',
        expiresAt: '2026-09-04T10:00:00.000Z',
        link: `https://app.quoteplate.example/join#token=${'A'.repeat(43)}`,
      },
    });
    expectPrivate(response);
    expect(JSON.stringify(body)).not.toContain('"token"');
    expect(create).toHaveBeenCalledWith(
      {
        actor: { userId: 'owner-a', tenantId: 'tenant-a' },
        email: ' MEMBER@EXAMPLE.COM ',
        role: 'OWNER',
      },
      undefined,
      new Date('2026-08-28T10:00:00.000Z'),
    );
  });

  it('maps invalid JSON, validation, forbidden, and unavailable errors safely', async () => {
    const create = jest.fn();
    const handlers = createMemberInvitationHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      create,
      revoke: jest.fn().mockRejectedValue(
        new InvitationError('FORBIDDEN', 403, 'Forbidden.'),
      ),
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });
    const malformed = new Request(
      'https://quoteplate.example/api/members/invitations',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://quoteplate.example',
          'sec-fetch-site': 'same-origin',
        },
        body: '{',
      },
    );

    expect((await handlers.POST(malformed)).status).toBe(400);
    expect(
      (
        await handlers.DELETE(
          jsonRequest(
            'https://quoteplate.example/api/members/invitations',
            'DELETE',
            { invitationId: 'invite-a' },
          ),
        )
      ).status,
    ).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects cross-origin, non-JSON, and oversized management requests privately', async () => {
    const create = jest.fn();
    const revoke = jest.fn();
    const handlers = createMemberInvitationHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      create,
      revoke,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });

    const crossOrigin = await handlers.POST(jsonRequest(
      'https://quoteplate.example/api/members/invitations',
      'POST',
      { email: 'member@example.com' },
      { origin: 'https://evil.example' },
    ));
    const nonJson = await handlers.DELETE(jsonRequest(
      'https://quoteplate.example/api/members/invitations',
      'DELETE',
      { invitationId: 'invite-a' },
      { contentType: 'text/plain' },
    ));
    const oversized = await handlers.POST(jsonRequest(
      'https://quoteplate.example/api/members/invitations',
      'POST',
      { email: 'member@example.com' },
      { length: '20000' },
    ));

    expect(crossOrigin.status).toBe(403);
    expect(nonJson.status).toBe(415);
    expect(oversized.status).toBe(413);
    [crossOrigin, nonJson, oversized].forEach(expectPrivate);
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('does not expose account lookup failures', async () => {
    const handlers = createMemberInvitationHandlers({
      accountContext: jest.fn().mockRejectedValue(
        new Error('database password from connection failure'),
      ),
      create: jest.fn(),
      revoke: jest.fn(),
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });

    const response = await handlers.POST(
      jsonRequest('https://quoteplate.example/api/members/invitations', 'POST', {
        email: 'member@example.com',
      }),
    );

    expect(response.status).toBe(503);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      status: 503,
      title: 'Invitation service unavailable',
      detail: 'Unable to manage invitations right now. Try again shortly.',
    });
  });

  it('rejects an unsafe configured site URL before creating an invitation', async () => {
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = 'https://operator:secret@app.quoteplate.example';
    const create = jest.fn();
    const handlers = createMemberInvitationHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      create,
      revoke: jest.fn(),
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });

    let response: Response;
    try {
      response = await handlers.POST(
        jsonRequest('https://quoteplate.example/api/members/invitations', 'POST', {
          email: 'member@example.com',
        }),
      );
    } finally {
      if (previousNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = previousNextAuthUrl;
    }

    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(create).not.toHaveBeenCalled();
  });

  it('allows plain HTTP only for a local development origin', async () => {
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = 'http://app.quoteplate.example';
    const create = jest.fn();
    const handlers = createMemberInvitationHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      create,
      revoke: jest.fn(),
      now: () => new Date('2026-08-28T10:00:00.000Z'),
    });

    let response: Response;
    try {
      response = await handlers.POST(
        jsonRequest('https://quoteplate.example/api/members/invitations', 'POST', {
          email: 'member@example.com',
        }),
      );
    } finally {
      if (previousNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = previousNextAuthUrl;
    }

    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('public invitation acceptance handler', () => {
  it('accepts bounded JSON and exposes no credential or account internals', async () => {
    const accept = jest.fn().mockResolvedValue({
      userId: 'member-a',
      tenantId: 'tenant-a',
    });
    const handler = createInvitationAcceptHandler({
      accept,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      clientRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 900 }),
    });
    const token = 'A'.repeat(43);

    const response = await handler(
      jsonRequest('https://quoteplate.example/api/invitations/accept', 'POST', {
        token,
        email: 'member@example.com',
        name: 'Priya Shah',
        password: 'correct horse battery staple',
      }),
    );

    expect(response.status).toBe(201);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('rejects cross-origin acceptance before reading or consuming the invitation', async () => {
    const accept = jest.fn();
    const handler = createInvitationAcceptHandler({
      accept,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      clientRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 900 }),
    });

    const response = await handler(jsonRequest(
      'https://quoteplate.example/api/invitations/accept',
      'POST',
      { token: 'A'.repeat(43), email: 'member@example.com' },
      { origin: 'https://evil.example' },
    ));

    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(accept).not.toHaveBeenCalled();
  });

  it('rejects non-JSON acceptance before reading or consuming the invitation', async () => {
    const accept = jest.fn();
    const handler = createInvitationAcceptHandler({
      accept,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      clientRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 900 }),
    });

    const response = await handler(jsonRequest(
      'https://quoteplate.example/api/invitations/accept',
      'POST',
      { token: 'A'.repeat(43), email: 'member@example.com' },
      { contentType: 'text/plain' },
    ));

    expect(response.status).toBe(415);
    expectPrivate(response);
    expect(accept).not.toHaveBeenCalled();
  });

  it('uses one 410 response for every unavailable invitation and rejects oversized bodies', async () => {
    const accept = jest.fn().mockRejectedValue(
      new InvitationError(
        'INVITATION_UNAVAILABLE',
        410,
        'This invitation is invalid or no longer available.',
      ),
    );
    const handler = createInvitationAcceptHandler({
      accept,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      clientRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 900 }),
    });
    const token = 'A'.repeat(43);
    const gone = await handler(
      jsonRequest('https://quoteplate.example/api/invitations/accept', 'POST', {
        token,
        email: 'wrong@example.com',
        name: 'Priya Shah',
        password: 'password-1',
      }),
    );
    const oversized = await handler(
      new Request('https://quoteplate.example/api/invitations/accept', {
        method: 'POST',
        headers: {
          'content-length': '20000',
          'content-type': 'application/json',
          origin: 'https://quoteplate.example',
          'sec-fetch-site': 'same-origin',
        },
        body: '{}',
      }),
    );

    expect(gone.status).toBe(410);
    expectPrivate(gone);
    await expect(gone.json()).resolves.toEqual({
      type: 'about:blank',
      status: 410,
      title: 'Invitation unavailable',
      detail: 'This invitation is invalid or no longer available.',
    });
    expect(oversized.status).toBe(413);
  });

  it('returns a retryable 429 without caching when an active link is throttled', async () => {
    const accept = jest.fn().mockRejectedValue(
      new InvitationError(
        'RATE_LIMITED',
        429,
        'Too many attempts. Try again later.',
        321,
      ),
    );
    const handler = createInvitationAcceptHandler({
      accept,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      clientRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 900 }),
    });
    const token = 'A'.repeat(43);

    const response = await handler(
      jsonRequest('https://quoteplate.example/api/invitations/accept', 'POST', {
        token,
        email: 'member@example.com',
        name: 'Priya Shah',
        password: 'password-1',
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('321');
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      status: 429,
      title: 'Too many attempts',
      detail: 'Too many attempts. Try again later.',
    });
  });

  it('stops reading an oversized streaming body without relying on content-length', async () => {
    const accept = jest.fn();
    const handler = createInvitationAcceptHandler({
      accept,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      clientRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 900 }),
    });
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls <= 2) {
            controller.enqueue(new Uint8Array(10 * 1_024));
            return;
          }
          controller.error(new Error('the reader crossed the configured limit'));
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request(
      'https://quoteplate.example/api/invitations/accept',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://quoteplate.example',
          'sec-fetch-site': 'same-origin',
        },
        body: stream,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' },
    );

    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(accept).not.toHaveBeenCalled();
  });

  it('limits a client before resolving an unknown invitation token', async () => {
    const accept = jest.fn();
    const clientRateLimit = jest.fn().mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
    });
    const handler = createInvitationAcceptHandler({
      accept,
      now: () => new Date('2026-08-28T10:00:00.000Z'),
      clientRateLimit,
    });
    const acceptRequest = jsonRequest(
      'https://quoteplate.example/api/invitations/accept',
      'POST',
      {
        token: 'A'.repeat(43),
        email: 'member@example.com',
        name: 'Priya Shah',
        password: 'correct horse battery staple',
      },
    );

    const response = await handler(acceptRequest);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
    expect(clientRateLimit).toHaveBeenCalledWith({
      request: acceptRequest,
      now: new Date('2026-08-28T10:00:00.000Z'),
    });
    expect(accept).not.toHaveBeenCalled();
  });
});
