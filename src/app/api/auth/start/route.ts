import { createEmailWorkspace } from '@/lib/auth/email-signup';
import { createAuthStartHandler } from '@/lib/auth/start-handler';

export const POST = createAuthStartHandler({
  env: process.env,
  emailSignup: createEmailWorkspace,
  now: () => new Date(),
});
