import { createTutorialRouteHandlers } from '@/lib/tutorial/tutorial-http';
import {
  TUTORIAL_LAST_STEP,
  TutorialVersionConflictError,
} from '@/lib/tutorial/tutorial-state';

const user = {
  id: 'user-a',
  tenantId: 'tenant-a',
  accountState: 'ACTIVE',
  isActive: true,
  tutorialVersion: 7,
  tutorialStep: 2,
  tutorialSkippedAt: null,
  tutorialCompletedAt: null,
};
const context = { tenant: { id: 'tenant-a' }, user };

function request(body: unknown, options: {
  origin?: string;
  contentType?: string;
  length?: string;
} = {}) {
  return new Request('https://quoteplate.example/api/tutorial', {
    method: 'PATCH',
    headers: {
      'content-type': options.contentType ?? 'application/json',
      origin: options.origin ?? 'https://quoteplate.example',
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

describe('tutorial API', () => {
  it('reads resumable state for the active current user', async () => {
    const handlers = createTutorialRouteHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      transition: jest.fn(),
    });

    const response = await handlers.GET();

    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      tutorial: {
        version: 7,
        step: 2,
        lastStep: TUTORIAL_LAST_STEP,
        skippedAt: null,
        completedAt: null,
      },
    });
  });

  it('accepts only the exact command and returns the updated state', async () => {
    const transition = jest.fn().mockResolvedValue({
      version: 8,
      step: 3,
      skippedAt: null,
      completedAt: null,
    });
    const handlers = createTutorialRouteHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      transition,
    });

    const response = await handlers.PATCH(
      request({ expectedVersion: 7, action: 'NEXT' }),
    );

    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(transition).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'user-a' },
      command: { expectedVersion: 7, action: 'NEXT' },
    });
    await expect(response.json()).resolves.toEqual({
      tutorial: {
        version: 8,
        step: 3,
        lastStep: TUTORIAL_LAST_STEP,
        skippedAt: null,
        completedAt: null,
      },
    });
  });

  it.each([
    [{ expectedVersion: 7, action: 'NEXT', extra: true }, 400],
    [{ expectedVersion: 7, action: 'PAUSE' }, 400],
    [{ expectedVersion: 0, action: 'NEXT' }, 400],
  ])('rejects invalid command %p', async (body, status) => {
    const transition = jest.fn();
    const handlers = createTutorialRouteHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      transition,
    });

    const response = await handlers.PATCH(request(body));

    expect(response.status).toBe(status);
    expectPrivate(response);
    expect(transition).not.toHaveBeenCalled();
  });

  it.each([
    [{ origin: 'https://evil.example' }, 403],
    [{ contentType: 'text/plain' }, 415],
    [{ length: '2049' }, 413],
  ])('rejects an unsafe request with %p', async (options, status) => {
    const accountContext = jest.fn().mockResolvedValue(context);
    const transition = jest.fn();
    const handlers = createTutorialRouteHandlers({ accountContext, transition });

    const response = await handlers.PATCH(
      request({ expectedVersion: 7, action: 'NEXT' }, options),
    );

    expect(response.status).toBe(status);
    expectPrivate(response);
    expect(accountContext).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...context, user: { ...user, accountState: 'INVITED', isActive: false } },
    { ...context, user: { ...user, accountState: 'DEACTIVATED', isActive: false } },
  ])('requires an active account context: %p', async (account) => {
    const transition = jest.fn();
    const handlers = createTutorialRouteHandlers({
      accountContext: jest.fn().mockResolvedValue(account),
      transition,
    });

    const response = await handlers.PATCH(
      request({ expectedVersion: 7, action: 'NEXT' }),
    );

    expect(response.status).toBe(401);
    expect(transition).not.toHaveBeenCalled();
  });

  it('maps a stale expectedVersion to 409 without exposing internals', async () => {
    const handlers = createTutorialRouteHandlers({
      accountContext: jest.fn().mockResolvedValue(context),
      transition: jest.fn().mockRejectedValue(
        new TutorialVersionConflictError(),
      ),
    });

    const response = await handlers.PATCH(
      request({ expectedVersion: 6, action: 'BACK' }),
    );

    expect(response.status).toBe(409);
    expectPrivate(response);
    await expect(response.json()).resolves.toMatchObject({
      status: 409,
      title: 'Tutorial changed',
    });
  });
});
