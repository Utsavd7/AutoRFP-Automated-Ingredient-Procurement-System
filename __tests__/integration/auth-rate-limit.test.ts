import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  consumeCredentialsRateLimit,
  consumeWorkspaceCreationRateLimit,
  digestAuthRateLimitSubject,
} from '@/lib/auth/rate-limit';
import {
  consumeDigestRateLimit,
  digestRateLimitKey,
} from '@/lib/security/rate-limit';

import { withMigratedPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

test('auth signup and credential quotas are atomic, domain-separated, and digest-only', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      const password = randomBytes(24).toString('hex');
      await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
      app = new PrismaClient({
        datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
      });
      await app.$connect();
      const consume = (input: Parameters<typeof consumeDigestRateLimit>[0]) =>
        consumeDigestRateLimit(input, app);
      const now = new Date('2026-08-28T00:00:00.000Z');
      const email = 'parallel-auth@example.test';

      await admin.rateLimitBucket.createMany({
        data: Array.from({ length: 40 }, (_, index) => ({
          keyDigest: index.toString(16).padStart(64, '0'),
          count: 1,
          resetAt: new Date(now.getTime() - 1_000),
        })),
      });
      await consumeWorkspaceCreationRateLimit(
        {
          email: 'cleanup-auth@example.test',
          request: new Request('https://quoteplate.example/api/auth/start'),
          now,
        },
        consume,
      );
      expect(
        await admin.rateLimitBucket.count({
          where: { resetAt: { lte: now } },
        }),
      ).toBe(15);
      await admin.rateLimitBucket.deleteMany();

      const signup = await Promise.all(
        Array.from({ length: 6 }, () =>
          consumeWorkspaceCreationRateLimit(
            {
              email,
              request: new Request('https://quoteplate.example/api/auth/start'),
              now,
            },
            consume,
          ),
        ),
      );
      expect(signup.filter(({ allowed }) => allowed)).toHaveLength(5);
      expect(signup.filter(({ allowed }) => !allowed)).toHaveLength(1);

      const credentials = await Promise.all(
        Array.from({ length: 11 }, () =>
          consumeCredentialsRateLimit(
            { email, clientIdentifier: null, now },
            consume,
          ),
        ),
      );
      expect(credentials.filter(({ allowed }) => allowed)).toHaveLength(10);
      expect(credentials.filter(({ allowed }) => !allowed)).toHaveLength(1);

      const buckets = await admin.rateLimitBucket.findMany({
        orderBy: { keyDigest: 'asc' },
      });
      expect(buckets).toHaveLength(2);
      expect(buckets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            keyDigest: digestRateLimitKey(
              'auth-workspace-create-email',
              digestAuthRateLimitSubject('email', email),
            ),
            count: 6,
          }),
          expect.objectContaining({
            keyDigest: digestRateLimitKey(
              'auth-credentials-email',
              digestAuthRateLimitSubject('email', email),
            ),
            count: 11,
          }),
        ]),
      );
      expect(JSON.stringify(buckets)).not.toContain(email);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
