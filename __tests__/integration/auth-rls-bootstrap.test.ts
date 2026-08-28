import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  authenticateCredentials,
  createPrismaCredentialsRepository,
} from '@/lib/auth/credentials';
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

import { withMigratedPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

async function provisionAppClient(admin: PrismaClient, databaseUrl: string) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(
    `ALTER ROLE autorfp_app PASSWORD '${password}'`,
  );
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

test('restricted runtime role safely bootstraps email and Google identity around forced RLS', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
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
              COALESCE(
                procedure.proacl,
                acldefault('f', procedure.proowner)
              )
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
          proname: 'autorfp_auth_identity_by_provider',
          security_definer: true,
          settings: ['search_path=pg_catalog'],
          app_can_execute: true,
          public_can_execute: false,
        },
      ]);
      await expect(
        app.$queryRaw`
          SELECT *
          FROM autorfp_private.autorfp_auth_credentials_by_email(${'x'.repeat(321)})
        `,
      ).resolves.toEqual([]);
      await expect(
        app.$queryRaw`
          SELECT *
          FROM autorfp_private.autorfp_auth_identity_by_provider(
            ${'github'},
            ${'provider-account'}
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
          'google',
          'google-sub-restricted-role',
        ),
      ).rejects.toMatchObject({ code: 'UNSAFE_DATABASE_ROLE' });

      const emailOwner = await createEmailWorkspace(
        emailSignup,
        emailRepository,
      );
      await expect(
        authenticateCredentials(
          {
            email: ' ASHA@EXAMPLE.TEST ',
            password: emailSignup.password,
          },
          credentialsRepository,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          userId: emailOwner.userId,
          tenantId: emailOwner.tenantId,
          email: 'asha@example.test',
        }),
      );

      await admin.user.update({
        where: { id: emailOwner.userId },
        data: { role: 'MEMBER' },
      });
      await expect(
        loadCurrentUser(
          { userId: emailOwner.userId, tenantId: emailOwner.tenantId },
          currentUserStore,
        ),
      ).resolves.toEqual(
        expect.objectContaining({ role: 'MEMBER', isActive: true }),
      );

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

      await expect(app.tenant.findMany()).resolves.toEqual([]);
      await expect(app.user.findMany()).resolves.toEqual([]);
      await expect(app.externalIdentity.findMany()).resolves.toEqual([]);

      expect(
        await admin.user.findUnique({ where: { id: emailOwner.userId } }),
      ).toEqual(
        expect.objectContaining({
          email: 'asha@example.test',
          lastLoginAt: expect.any(Date),
        }),
      );
      expect(
        await admin.externalIdentity.findUnique({
          where: {
            provider_providerAccountId: {
              provider: 'google',
              providerAccountId: 'google-sub-restricted-role',
            },
          },
        }),
      ).toEqual(
        expect.objectContaining({
          tenantId: googleOwner.tenantId,
          userId: googleOwner.userId,
        }),
      );
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
