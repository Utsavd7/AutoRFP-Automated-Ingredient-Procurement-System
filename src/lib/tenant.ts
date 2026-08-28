// Transitional response shape used by the current app shell. Account identity
// and authorization live only in the server session and PostgreSQL.
export type RestaurantAccount = {
  tenantId: string;
  name: string;
  email: string;
  location: string;
  cuisineType: string;
  preferredSuppliers: string[];
  monthlyBudgetTarget: number | null;
  savingsTargetPct: number | null;
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  phone: string;
  timezone: string;
  gstin: string | null;
  createdAt: string;
};
