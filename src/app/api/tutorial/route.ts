import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import {
  RequestBodyTooLargeError,
  readBoundedJson,
} from '@/lib/api/read-bounded-json';
import { requireAccountContext } from '@/lib/server-account';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import {
  TutorialAccessError,
  TutorialCommandError,
  TutorialVersionConflictError,
  parseTutorialCommand,
  tutorialOperations,
  tutorialStateDto,
  tutorialStateFromUser,
} from '@/lib/tutorial/tutorial-state';

const MAX_TUTORIAL_BODY_BYTES = 2 * 1_024;

type AccountContext = Awaited<ReturnType<typeof requireAccountContext>>;

type TutorialRouteDependencies = {
  accountContext: () => Promise<AccountContext>;
  transition: typeof tutorialOperations.transition;
};

function activeContext(context: AccountContext) {
  return context &&
    context.user.accountState === 'ACTIVE' &&
    context.user.isActive &&
    context.user.tenantId === context.tenant.id
    ? context
    : null;
}

function privateProblem(status: number, title: string, detail: string) {
  return privateNoStoreResponse(problemResponse(status, title, detail));
}

function tutorialError(error: unknown) {
  if (error instanceof TutorialVersionConflictError) {
    return privateProblem(409, 'Tutorial changed', error.message);
  }
  if (error instanceof TutorialAccessError) {
    return privateProblem(401, 'Unauthorized', error.message);
  }
  return privateProblem(
    503,
    'Tutorial unavailable',
    'Unable to update the tutorial right now. Try again shortly.',
  );
}

export function createTutorialRouteHandlers(
  dependencies: TutorialRouteDependencies,
) {
  async function currentAccount() {
    try {
      return activeContext(await dependencies.accountContext());
    } catch {
      return 'UNAVAILABLE' as const;
    }
  }

  return {
    async GET() {
      const account = await currentAccount();
      if (account === 'UNAVAILABLE') {
        return privateProblem(
          503,
          'Tutorial unavailable',
          'Unable to load the tutorial right now. Try again shortly.',
        );
      }
      if (!account) {
        return privateProblem(401, 'Unauthorized', 'Authentication is required.');
      }
      return privateNoStoreResponse(Response.json({
        tutorial: tutorialStateDto(tutorialStateFromUser(account.user)),
      }));
    },

    async PATCH(request: Request) {
      const rejection = browserJsonMutationRejection(request);
      if (rejection === 'CROSS_ORIGIN') {
        return privateProblem(
          403,
          'Request not allowed',
          'Update the tutorial from the QuotePlate workspace.',
        );
      }
      if (rejection === 'UNSUPPORTED_MEDIA_TYPE') {
        return privateProblem(
          415,
          'Unsupported media type',
          'Send this request as application/json.',
        );
      }

      let command;
      try {
        command = parseTutorialCommand(
          await readBoundedJson(request, MAX_TUTORIAL_BODY_BYTES),
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return privateProblem(
            413,
            'Request too large',
            'Tutorial commands must be smaller than 2 KB.',
          );
        }
        if (error instanceof TutorialCommandError) {
          return privateProblem(400, 'Invalid request', error.message);
        }
        return privateProblem(
          400,
          'Invalid request',
          'Provide a valid JSON tutorial command.',
        );
      }

      const account = await currentAccount();
      if (account === 'UNAVAILABLE') {
        return privateProblem(
          503,
          'Tutorial unavailable',
          'Unable to update the tutorial right now. Try again shortly.',
        );
      }
      if (!account) {
        return privateProblem(401, 'Unauthorized', 'Authentication is required.');
      }

      try {
        const tutorial = await dependencies.transition({
          actor: { tenantId: account.tenant.id, userId: account.user.id },
          command,
        });
        return privateNoStoreResponse(Response.json({
          tutorial: tutorialStateDto(tutorial),
        }));
      } catch (error) {
        return tutorialError(error);
      }
    },
  };
}

const handlers = createTutorialRouteHandlers({
  accountContext: requireAccountContext,
  transition: (input) => tutorialOperations.transition(input),
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
