import { requireAccountContext } from '@/lib/server-account';
import { createTutorialRouteHandlers } from '@/lib/tutorial/tutorial-http';
import { tutorialOperations } from '@/lib/tutorial/tutorial-state';

const handlers = createTutorialRouteHandlers({
  accountContext: requireAccountContext,
  transition: (input) => tutorialOperations.transition(input),
});

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
