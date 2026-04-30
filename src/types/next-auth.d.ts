import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
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
    tenantId?: string;
    location?: string;
    cuisineType?: string;
    preferredSuppliers?: string[];
    monthlyBudgetTarget?: number | null;
    savingsTargetPct?: number | null;
  }
}
