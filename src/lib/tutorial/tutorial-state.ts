import type { Prisma, PrismaClient } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { withTenant } from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';

export const TUTORIAL_ACTIONS = [
  'NEXT',
  'BACK',
  'SKIP',
  'RESUME',
  'RESTART',
  'COMPLETE',
] as const;

export type TutorialAction = (typeof TUTORIAL_ACTIONS)[number];

export type TutorialCommand = {
  expectedVersion: number;
  action: TutorialAction;
};

export type TutorialState = {
  version: number;
  step: number;
  skippedAt: Date | null;
  completedAt: Date | null;
};

export type TutorialStateDto = {
  version: number;
  step: number;
  lastStep: number;
  skippedAt: string | null;
  completedAt: string | null;
};

// The six planned UI targets are indexed 0–5.
export const TUTORIAL_LAST_STEP = 5;

export class TutorialCommandError extends Error {
  readonly code = 'INVALID_TUTORIAL_COMMAND';
  readonly status = 400;

  constructor() {
    super('Provide a valid tutorial command.');
    this.name = 'TutorialCommandError';
  }
}

export class TutorialVersionConflictError extends Error {
  readonly code = 'TUTORIAL_VERSION_CONFLICT';
  readonly status = 409;

  constructor() {
    super('The tutorial changed in another session.');
    this.name = 'TutorialVersionConflictError';
  }
}

export class TutorialAccessError extends Error {
  readonly code = 'TUTORIAL_UNAUTHORIZED';
  readonly status = 401;

  constructor() {
    super('Authentication is required.');
    this.name = 'TutorialAccessError';
  }
}

const tutorialActions = new Set<string>(TUTORIAL_ACTIONS);

export function parseTutorialCommand(value: unknown): TutorialCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TutorialCommandError();
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length !== 2 ||
    !keys.includes('expectedVersion') ||
    !keys.includes('action') ||
    !Number.isSafeInteger(input.expectedVersion) ||
    (input.expectedVersion as number) < 1 ||
    typeof input.action !== 'string' ||
    !tutorialActions.has(input.action)
  ) {
    throw new TutorialCommandError();
  }
  return {
    expectedVersion: input.expectedVersion as number,
    action: input.action as TutorialAction,
  };
}

export function transitionTutorialState(
  current: TutorialState,
  action: TutorialAction,
  now: Date,
): TutorialState {
  const next = { ...current, version: current.version + 1 };
  switch (action) {
    case 'NEXT':
      return { ...next, step: Math.min(current.step + 1, TUTORIAL_LAST_STEP) };
    case 'BACK':
      return { ...next, step: Math.max(current.step - 1, 0) };
    case 'SKIP':
      return { ...next, skippedAt: now };
    case 'RESUME':
      return { ...next, skippedAt: null };
    case 'RESTART':
      return { ...next, step: 0, skippedAt: null, completedAt: null };
    case 'COMPLETE':
      return { ...next, step: TUTORIAL_LAST_STEP, completedAt: now };
  }
}

type TutorialStateRecord = {
  tutorialVersion: number;
  tutorialStep: number;
  tutorialSkippedAt: Date | null;
  tutorialCompletedAt: Date | null;
};

export function tutorialStateFromUser(user: TutorialStateRecord): TutorialState {
  return {
    version: user.tutorialVersion,
    step: user.tutorialStep,
    skippedAt: user.tutorialSkippedAt,
    completedAt: user.tutorialCompletedAt,
  };
}

export function tutorialStateDto(state: TutorialState): TutorialStateDto {
  return {
    version: state.version,
    step: state.step,
    lastStep: TUTORIAL_LAST_STEP,
    skippedAt: state.skippedAt?.toISOString() ?? null,
    completedAt: state.completedAt?.toISOString() ?? null,
  };
}

type TutorialActor = { tenantId: string; userId: string };

type TutorialDependencies = {
  transact: <T>(
    tenantId: string,
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  now: () => Date;
  writeAudit: typeof writeAuditEvent;
};

const defaultDependencies: TutorialDependencies = {
  transact: (tenantId, callback) => withTenant(tenantId, callback, prisma),
  now: () => new Date(),
  writeAudit: writeAuditEvent,
};

export function createTutorialOperations(
  dependencies: TutorialDependencies = defaultDependencies,
) {
  return {
    transition(input: { actor: TutorialActor; command: TutorialCommand }) {
      return dependencies.transact(
        input.actor.tenantId,
        async (transaction) => {
          const user = await transaction.user.findFirst({
            where: {
              id: input.actor.userId,
              tenantId: input.actor.tenantId,
              accountState: 'ACTIVE',
              isActive: true,
            },
            select: {
              tutorialVersion: true,
              tutorialStep: true,
              tutorialSkippedAt: true,
              tutorialCompletedAt: true,
            },
          });
          if (!user) throw new TutorialAccessError();
          if (user.tutorialVersion !== input.command.expectedVersion) {
            throw new TutorialVersionConflictError();
          }

          const next = transitionTutorialState(
            tutorialStateFromUser(user),
            input.command.action,
            dependencies.now(),
          );
          const updated = await transaction.user.updateMany({
            where: {
              id: input.actor.userId,
              tenantId: input.actor.tenantId,
              accountState: 'ACTIVE',
              isActive: true,
              tutorialVersion: input.command.expectedVersion,
            },
            data: {
              tutorialVersion: next.version,
              tutorialStep: next.step,
              tutorialSkippedAt: next.skippedAt,
              tutorialCompletedAt: next.completedAt,
            },
          });
          if (updated.count !== 1) throw new TutorialVersionConflictError();

          await dependencies.writeAudit(transaction, {
            tenantId: input.actor.tenantId,
            actorUserId: input.actor.userId,
            action: 'tutorial.updated',
            entityId: input.actor.userId,
            metadata: { action: input.command.action, step: next.step },
          });
          return next;
        },
      );
    },
  };
}

type TutorialClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

export function createPrismaTutorialOperations(client: TutorialClient) {
  return createTutorialOperations({
    ...defaultDependencies,
    transact: (tenantId, callback) => withTenant(tenantId, callback, client),
  });
}

export const tutorialOperations = createTutorialOperations();
