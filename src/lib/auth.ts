import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { Prisma } from '@prisma/client';
import { makeTenantId, parseSuppliers } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';
import { createPasswordRecord, verifyPassword } from '@/lib/password';

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
        if (!email || !email.includes('@')) throw new Error('Enter a valid work email.');
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');

        if (mode === 'signin') {
          const tenant = await prisma.tenant.findFirst({ where: { email } });
          if (!tenant || !verifyPassword(password, tenant.passwordHash, tenant.passwordSalt)) throw new Error('Email or password is incorrect.');
          return {
            id: tenant.id,
            tenantId: tenant.id,
            name: tenant.restaurantName,
            email: tenant.email,
            location: tenant.location,
            cuisineType: tenant.cuisineType || 'General restaurant',
            preferredSuppliers: tenant.preferredSuppliers,
            monthlyBudgetTarget: tenant.monthlyBudgetTarget,
            savingsTargetPct: tenant.savingsTargetPct,
          } as any;
        }

        if (!name) throw new Error('Restaurant name is required.');
        if (!location) throw new Error('Location is required.');
        const existing = await prisma.tenant.findFirst({ where: { email } });
        if (existing) throw new Error('A workspace already exists for that email. Use Sign in instead.');

        const tenantId = makeTenantId(email, name);
        const passwordRecord = createPasswordRecord(password);
        let tenant;
        try {
          tenant = await prisma.tenant.create({
            data: {
              id: tenantId,
              restaurantName: name,
              email,
              ...passwordRecord,
              location,
              cuisineType: credentials?.cuisineType?.trim() || 'General restaurant',
              preferredSuppliers: parseSuppliers(credentials?.preferredSuppliers ?? ''),
              monthlyBudgetTarget: credentials?.monthlyBudgetTarget ? Number(credentials.monthlyBudgetTarget) : null,
              savingsTargetPct: credentials?.savingsTargetPct ? Number(credentials.savingsTargetPct) : null,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new Error('A workspace already exists for that email. Use Sign in instead.');
          }
          throw new Error('Unable to create workspace. Check the database connection and try again.');
        }
        return {
          id: tenant.id,
          tenantId: tenant.id,
          name: tenant.restaurantName,
          email: tenant.email,
          location: tenant.location,
          cuisineType: tenant.cuisineType || 'General restaurant',
          preferredSuppliers: tenant.preferredSuppliers,
          monthlyBudgetTarget: tenant.monthlyBudgetTarget,
          savingsTargetPct: tenant.savingsTargetPct,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const tenantUser = user as any;
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
        tenantId: token.tenantId,
        location: token.location,
        cuisineType: token.cuisineType,
        preferredSuppliers: token.preferredSuppliers,
        monthlyBudgetTarget: token.monthlyBudgetTarget,
        savingsTargetPct: token.savingsTargetPct,
      } as any;
      return session;
    },
  },
};
