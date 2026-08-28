import {
  checkRuntimeDatabase,
  createReadinessHandler,
} from '@/lib/health/readiness';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function checkDatabase() {
  await checkRuntimeDatabase(prisma);
}

const readiness = createReadinessHandler({
  environment: process.env,
  checkDatabase,
  timeoutMs: 2_000,
});

export async function GET() {
  return readiness();
}
