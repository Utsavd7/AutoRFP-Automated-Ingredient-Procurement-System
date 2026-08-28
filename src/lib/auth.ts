import { Prisma } from '@prisma/client';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

import { createPasswordRecord, verifyPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';

const REVIEW_REQUIRED = 'LEGACY_REVIEW_REQUIRED';

type TenantAuthUser = {
  tenantId: string;
  userId: string;
  location: string;
  cuisineType: string;
  preferredSuppliers: string[];
  monthlyBudgetTarget: number | null;
  savingsTargetPct: number | null;
};

function visibleLocation(tenant: {
  addressLine: string;
  city: string;
  state: string;
  pin: string;
}) {
  const parts = [tenant.addressLine, tenant.city, tenant.state, tenant.pin].filter(
    (part) => part && part !== REVIEW_REQUIRED && part !== '000000',
  );
  return parts.join(', ') || tenant.addressLine;
}

function authUser(user: {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  tenant: {
    addressLine: string;
    city: string;
    state: string;
    pin: string;
  };
}) {
  return {
    id: user.id,
    userId: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    location: visibleLocation(user.tenant),
    cuisineType: 'General restaurant',
    preferredSuppliers: [],
    monthlyBudgetTarget: null,
    savingsTargetPct: null,
  };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  providers: [
    CredentialsProvider({
      name: 'Restaurant Workspace',
      credentials: {
        name: { label: 'Restaurant name', type: 'text' },
        email: { label: 'Work email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        location: { label: 'Location', type: 'text' },
        cuisineType: { label: 'Cuisine type', type: 'text' },
        preferredSuppliers: { label: 'Preferred suppliers', type: 'text' },
        monthlyBudgetTarget: { label: 'Monthly budget target', type: 'text' },
        savingsTargetPct: { label: 'Savings target percent', type: 'text' },
        mode: { label: 'Mode', type: 'text' },
      },
      async authorize(credentials) {
        const mode = credentials?.mode === 'signup' ? 'signup' : 'signin';
        const name = credentials?.name?.trim();
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password ?? '';
        const location = credentials?.location?.trim();

        if (!email || !email.includes('@')) {
          throw new Error('Enter a valid work email.');
        }
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters.');
        }

        if (mode === 'signin') {
          const user = await prisma.user.findUnique({
            where: { email },
            include: { tenant: true },
          });
          if (
            !user ||
            !user.isActive ||
            !user.tenant.isActive ||
            !verifyPassword(
              password,
              user.passwordHash,
              user.legacyPasswordSalt,
            )
          ) {
            throw new Error('Email or password is incorrect.');
          }
          return authUser(user);
        }

        if (!name) throw new Error('Restaurant name is required.');
        if (!location) throw new Error('Location is required.');
        if (await prisma.user.findUnique({ where: { email } })) {
          throw new Error(
            'A workspace already exists for that email. Use Sign in instead.',
          );
        }

        const { passwordHash, passwordSalt } = createPasswordRecord(password);
        try {
          const tenant = await prisma.tenant.create({
            data: {
              name,
              addressLine: location,
              city: REVIEW_REQUIRED,
              state: REVIEW_REQUIRED,
              pin: '000000',
              phone: REVIEW_REQUIRED,
              users: {
                create: {
                  name: `${name} Owner`,
                  email,
                  passwordHash,
                  legacyPasswordSalt: passwordSalt,
                  role: 'OWNER',
                },
              },
            },
            include: { users: true },
          });
          const user = tenant.users[0];
          return authUser({ ...user, tenant });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new Error(
              'A workspace already exists for that email. Use Sign in instead.',
            );
          }
          throw new Error(
            'Unable to create workspace. Check the database connection and try again.',
          );
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const tenantUser = user as typeof user & TenantAuthUser;
        token.userId = tenantUser.userId;
        token.tenantId = tenantUser.tenantId;
        token.location = tenantUser.location;
        token.cuisineType = tenantUser.cuisineType;
        token.preferredSuppliers = tenantUser.preferredSuppliers;
        token.monthlyBudgetTarget = tenantUser.monthlyBudgetTarget;
        token.savingsTargetPct = tenantUser.savingsTargetPct;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        userId: token.userId,
        tenantId: token.tenantId,
        location: token.location,
        cuisineType: token.cuisineType,
        preferredSuppliers: token.preferredSuppliers,
        monthlyBudgetTarget: token.monthlyBudgetTarget,
        savingsTargetPct: token.savingsTargetPct,
      };
      return session;
    },
  },
};
