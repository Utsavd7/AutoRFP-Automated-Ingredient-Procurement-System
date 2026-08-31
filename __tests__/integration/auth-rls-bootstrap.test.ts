import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  authenticateCredentials,
  createPrismaCredentialsRepository,
} from '@/lib/auth/credentials';
import { consumeCredentialsRateLimit } from '@/lib/auth/rate-limit';
import {
  createPrismaCurrentUserStore,
  loadCurrentUser,
} from '@/lib/auth/current-user';
import {
  createEmailWorkspace,
  createPrismaEmailSignupRepository,
} from '@/lib/auth/email-signup';
import {
  createPrismaGoogleIdentityRepository,
  resolveGoogleIdentity,
} from '@/lib/auth/google-identity';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';

import { withMigratedPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

async function provisionAppClient(admin: PrismaClient, databaseUrl: string) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
  const client = new PrismaClient({
    datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
  });
  await client.$connect();
  return client;
}

const emailSignup = {
  restaurantName: 'Tamarind Table',
  ownerName: 'Asha Rao',
  email: 'ASHA@EXAMPLE.TEST',
  password: 'correct horse staple',
  addressLine: '12 Market Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560001',
  phone: '+919876543210',
  timezone: 'Asia/Kolkata',
  gstin: null,
};

const googleOnboarding = {
  restaurantName: 'Monsoon Canteen',
  ownerName: 'Neha Shah',
  email: 'neha@example.test',
  addressLine: '9 Station Road',
  city: 'Ahmedabad',
  state: 'Gujarat',
  pin: '380001',
  phone: '+919876543211',
  timezone: 'Asia/Kolkata',
  gstin: null,
  expiresAt: '2026-08-28T00:10:00.000Z',
};

test('restricted runtime role bootstraps compact active users around forced RLS', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;

    try {
      app = await provisionAppClient(admin, databaseUrl);
      const authFunctions = await admin.$queryRaw<
        Array<{
          proname: string;
          security_definer: boolean;
          settings: string[];
          app_can_execute: boolean;
          public_can_execute: boolean;
        }>
      >`
        SELECT
          procedure.proname,
          procedure.prosecdef AS security_definer,
          procedure.proconfig AS settings,
          has_function_privilege('autorfp_app', procedure.oid, 'EXECUTE')
            AS app_can_execute,
          EXISTS (
            SELECT 1
            FROM aclexplode(
              COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
            ) AS permission
            WHERE permission.grantee = 0
              AND permission.privilege_type = 'EXECUTE'
          ) AS public_can_execute
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'autorfp_private'
          AND procedure.proname LIKE 'autorfp_auth_%'
        ORDER BY procedure.proname
      `;
      expect(authFunctions).toEqual([
        {
          proname: 'autorfp_auth_credentials_by_email',
          security_definer: true,
          settings: ['search_path=pg_catalog'],
          app_can_execute: true,
          public_can_execute: false,
        },
        {
          proname: 'autorfp_auth_identity_by_email',
          security_definer: true,
          settings: ['search_path=pg_catalog'],
          app_can_execute: true,
          public_can_execute: false,
        },
        {
          proname: 'autorfp_auth_identity_by_google_subject',
          security_definer: true,
          settings: ['search_path=pg_catalog'],
          app_can_execute: true,
          public_can_execute: false,
        },
      ]);
      await expect(
        app.$queryRaw`
          SELECT *
          FROM autorfp_private.autorfp_auth_identity_by_google_subject(
            ${'x'.repeat(513)}
          )
        `,
      ).resolves.toEqual([]);

      const emailRepository = createPrismaEmailSignupRepository(app);
      const credentialsRepository = createPrismaCredentialsRepository(app);
      const googleRepository = createPrismaGoogleIdentityRepository(app);
      const currentUserStore = createPrismaCurrentUserStore(app);

      await expect(
        createPrismaCredentialsRepository(admin).findByEmail(
          'asha@example.test',
        ),
      ).rejects.toMatchObject({ code: 'UNSAFE_DATABASE_ROLE' });
      await expect(
        createPrismaGoogleIdentityRepository(admin).findIdentity(
          'google-sub-restricted-role',
        ),
      ).rejects.toMatchObject({ code: 'UNSAFE_DATABASE_ROLE' });

      const emailOwner = await createEmailWorkspace(emailSignup, emailRepository);
      const emailOwnerRow = await admin.user.findUniqueOrThrow({
        where: { id: emailOwner.userId },
      });
      expect(emailOwnerRow).toMatchObject({
        tenantId: emailOwner.tenantId,
        email: 'asha@example.test',
        role: 'OWNER',
        accountState: 'ACTIVE',
        isActive: true,
      });
      await expect(
        authenticateCredentials(
          {
            email: ' ASHA@EXAMPLE.TEST ',
            password: emailSignup.password,
          },
          credentialsRepository,
          {
            clientIdentifier: '203.0.113.9',
            now: new Date('2026-08-28T00:00:00.000Z'),
            rateLimit: (input) =>
              consumeCredentialsRateLimit(
                input,
                (attempt) => consumeDigestRateLimit(attempt, app!),
              ),
          },
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          userId: emailOwner.userId,
          tenantId: emailOwner.tenantId,
          email: 'asha@example.test',
        }),
      );

      for (const accountState of ['INVITED', 'DEACTIVATED'] as const) {
        const id = accountState.toLowerCase();
        await admin.user.create({
          data: {
            id,
            tenantId: emailOwner.tenantId,
            name: id,
            email: `${id}@example.test`,
            passwordHash: emailOwnerRow.passwordHash,
            accountState,
            isActive: false,
          },
        });
        await expect(
          authenticateCredentials(
            { email: `${id}@example.test`, password: emailSignup.password },
            credentialsRepository,
            {
              clientIdentifier: `198.51.100.${accountState === 'INVITED' ? 1 : 2}`,
              now: new Date('2026-08-28T01:00:00.000Z'),
              rateLimit: (input) =>
                consumeCredentialsRateLimit(
                  input,
                  (attempt) => consumeDigestRateLimit(attempt, app!),
                ),
            },
          ),
        ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
        await expect(
          loadCurrentUser(
            { userId: id, tenantId: emailOwner.tenantId },
            currentUserStore,
          ),
        ).resolves.toBeNull();
      }

      const account = {
        provider: 'google',
        providerAccountId: 'google-sub-restricted-role',
      };
      const profile = {
        sub: 'google-sub-restricted-role',
        email: 'neha@example.test',
        email_verified: true,
      };
      const googleOwner = await resolveGoogleIdentity(
        { account, profile, onboarding: googleOnboarding },
        googleRepository,
      );
      await expect(
        resolveGoogleIdentity(
          {
            account,
            profile: { ...profile, email: 'changed@example.test' },
            onboarding: null,
          },
          googleRepository,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          userId: googleOwner.userId,
          tenantId: googleOwner.tenantId,
          email: 'neha@example.test',
        }),
      );
      expect(
        await admin.user.findUniqueOrThrow({ where: { id: googleOwner.userId } }),
      ).toMatchObject({
        googleSubject: 'google-sub-restricted-role',
        role: 'OWNER',
        accountState: 'ACTIVE',
        isActive: true,
      });

      await expect(
        createEmailWorkspace(
          {
            ...emailSignup,
            restaurantName: 'Duplicate Kitchen',
            email: 'asha@example.test',
          },
          emailRepository,
        ),
      ).rejects.toMatchObject({
        code: 'EMAIL_ALREADY_REGISTERED',
        status: 409,
        message: 'A workspace already exists for that email. Use Sign in instead.',
      });

      await expect(app.tenant.findMany()).resolves.toEqual([]);
      await expect(app.user.findMany()).resolves.toEqual([]);
      expect(await admin.tenant.count()).toBe(2);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
