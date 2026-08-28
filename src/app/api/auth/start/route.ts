import { createEmailWorkspace } from '@/lib/auth/email-signup';
import { consumeWorkspaceCreationRateLimit } from '@/lib/auth/rate-limit';
import { createAuthStartHandler } from '@/lib/auth/start-handler';

export const POST = createAuthStartHandler({
  env: process.env,
  emailSignup: createEmailWorkspace,
  now: () => new Date(),
  rateLimit: consumeWorkspaceCreationRateLimit,
});
