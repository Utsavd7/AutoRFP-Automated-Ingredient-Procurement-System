import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { makeTenantId, parseSuppliers } from '@/lib/tenant';

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
      },
      async authorize(credentials) {
        const name = credentials?.name?.trim();
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password ?? '';
        const location = credentials?.location?.trim();
        if (!name || !email || !email.includes('@') || password.length < 8 || !location) return null;

        const tenantId = makeTenantId(email, name);
        return {
          id: tenantId,
          tenantId,
          name,
          email,
          location,
          cuisineType: credentials?.cuisineType?.trim() || 'General restaurant',
          preferredSuppliers: parseSuppliers(credentials?.preferredSuppliers ?? ''),
          monthlyBudgetTarget: credentials?.monthlyBudgetTarget ? Number(credentials.monthlyBudgetTarget) : null,
          savingsTargetPct: credentials?.savingsTargetPct ? Number(credentials.savingsTargetPct) : null,
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
