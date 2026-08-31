import {
  TUTORIAL_LAST_STEP,
  TutorialCommandError,
  TutorialVersionConflictError,
  createTutorialOperations,
  parseTutorialCommand,
  transitionTutorialState,
  type TutorialAction,
  type TutorialState,
} from '@/lib/tutorial/tutorial-state';

const now = new Date('2026-08-31T10:00:00.000Z');
const state: TutorialState = {
  version: 7,
  step: 2,
  skippedAt: null,
  completedAt: null,
};

describe('tutorial state', () => {
  it.each<{
    action: TutorialAction;
    current: TutorialState;
    expected: Partial<TutorialState>;
  }>([
    {
      action: 'NEXT',
      current: state,
      expected: { version: 8, step: 3 },
    },
    {
      action: 'NEXT',
      current: { ...state, step: TUTORIAL_LAST_STEP },
      expected: { version: 8, step: TUTORIAL_LAST_STEP },
    },
    {
      action: 'BACK',
      current: state,
      expected: { version: 8, step: 1 },
    },
    {
      action: 'BACK',
      current: { ...state, step: 0 },
      expected: { version: 8, step: 0 },
    },
    {
      action: 'SKIP',
      current: state,
      expected: { version: 8, step: 2, skippedAt: now },
    },
    {
      action: 'COMPLETE',
      current: state,
      expected: {
        version: 8,
        step: TUTORIAL_LAST_STEP,
        completedAt: now,
      },
    },
  ])('$action applies its bounded transition', ({ action, current, expected }) => {
    expect(transitionTutorialState(current, action, now)).toMatchObject(expected);
  });

  it('RESUME preserves progress and timestamps while advancing the revision', () => {
    const current = {
      ...state,
      skippedAt: new Date('2026-08-30T08:00:00.000Z'),
      completedAt: new Date('2026-08-30T09:00:00.000Z'),
    };

    expect(transitionTutorialState(current, 'RESUME', now)).toEqual({
      ...current,
      version: 8,
    });
  });

  it('RESTART resets progress and timestamps', () => {
    expect(
      transitionTutorialState(
        {
          ...state,
          step: TUTORIAL_LAST_STEP,
          skippedAt: new Date('2026-08-30T08:00:00.000Z'),
          completedAt: new Date('2026-08-30T09:00:00.000Z'),
        },
        'RESTART',
        now,
      ),
    ).toEqual({
      version: 8,
      step: 0,
      skippedAt: null,
      completedAt: null,
    });
  });

  it.each([
    null,
    {},
    { expectedVersion: 7 },
    { expectedVersion: 7, action: 'PAUSE' },
    { expectedVersion: 0, action: 'NEXT' },
    { expectedVersion: 7.5, action: 'NEXT' },
    { expectedVersion: 7, action: 'NEXT', step: 2 },
  ])('rejects commands outside the exact contract: %p', (command) => {
    expect(() => parseTutorialCommand(command)).toThrow(TutorialCommandError);
  });

  it.each<TutorialAction>([
    'NEXT',
    'BACK',
    'SKIP',
    'RESUME',
    'RESTART',
    'COMPLETE',
  ])('accepts the %s command', (action) => {
    expect(parseTutorialCommand({ expectedVersion: 7, action })).toEqual({
      expectedVersion: 7,
      action,
    });
  });

  it('persists a transition and writes only action and step audit metadata', async () => {
    const user = {
      tutorialVersion: 7,
      tutorialStep: 2,
      tutorialSkippedAt: null,
      tutorialCompletedAt: null,
    };
    const transaction = {
      user: {
        findFirst: jest.fn().mockResolvedValue(user),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const writeAudit = jest.fn().mockResolvedValue(undefined);
    const operations = createTutorialOperations({
      transact: async (_tenantId, callback) => callback(transaction as never),
      now: () => now,
      writeAudit: writeAudit as never,
    });

    await expect(
      operations.transition({
        actor: { tenantId: 'tenant-a', userId: 'user-a' },
        command: { expectedVersion: 7, action: 'NEXT' },
      }),
    ).resolves.toMatchObject({ version: 8, step: 3 });
    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-a',
        tenantId: 'tenant-a',
        accountState: 'ACTIVE',
        isActive: true,
        tutorialVersion: 7,
      },
      data: {
        tutorialVersion: 8,
        tutorialStep: 3,
        tutorialSkippedAt: null,
        tutorialCompletedAt: null,
      },
    });
    expect(writeAudit).toHaveBeenCalledWith(transaction, {
      tenantId: 'tenant-a',
      actorUserId: 'user-a',
      action: 'tutorial.updated',
      entityId: 'user-a',
      metadata: { action: 'NEXT', step: 3 },
    });
  });

  it('returns a 409 conflict when the expected revision is stale', async () => {
    const transaction = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          tutorialVersion: 8,
          tutorialStep: 2,
          tutorialSkippedAt: null,
          tutorialCompletedAt: null,
        }),
        updateMany: jest.fn(),
      },
    };
    const operations = createTutorialOperations({
      transact: async (_tenantId, callback) => callback(transaction as never),
      now: () => now,
      writeAudit: jest.fn() as never,
    });

    await expect(
      operations.transition({
        actor: { tenantId: 'tenant-a', userId: 'user-a' },
        command: { expectedVersion: 7, action: 'NEXT' },
      }),
    ).rejects.toMatchObject<Partial<TutorialVersionConflictError>>({
      status: 409,
      code: 'TUTORIAL_VERSION_CONFLICT',
    });
    expect(transaction.user.updateMany).not.toHaveBeenCalled();
  });

  it('returns a 409 without auditing when a concurrent write wins the CAS', async () => {
    const transaction = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          tutorialVersion: 7,
          tutorialStep: 2,
          tutorialSkippedAt: null,
          tutorialCompletedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const writeAudit = jest.fn();
    const operations = createTutorialOperations({
      transact: async (_tenantId, callback) => callback(transaction as never),
      now: () => now,
      writeAudit: writeAudit as never,
    });

    await expect(
      operations.transition({
        actor: { tenantId: 'tenant-a', userId: 'user-a' },
        command: { expectedVersion: 7, action: 'NEXT' },
      }),
    ).rejects.toMatchObject<Partial<TutorialVersionConflictError>>({
      status: 409,
      code: 'TUTORIAL_VERSION_CONFLICT',
    });
    expect(transaction.user.updateMany).toHaveBeenCalledTimes(1);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
