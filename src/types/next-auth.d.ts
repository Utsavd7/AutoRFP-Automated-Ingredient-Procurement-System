import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      userId?: string;
      tenantId?: string;
      location?: string;
      cuisineType?: string;
      preferredSuppliers?: string[];
      monthlyBudgetTarget?: number | null;
      savingsTargetPct?: number | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    tenantId?: string;
    location?: string;
    cuisineType?: string;
    preferredSuppliers?: string[];
    monthlyBudgetTarget?: number | null;
    savingsTargetPct?: number | null;
  }
}
