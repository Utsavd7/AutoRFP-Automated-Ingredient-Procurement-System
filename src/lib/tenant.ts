export type RestaurantAccount = {
  tenantId: string;
  name: string;
  email: string;
  passwordHash?: string;
  passwordSalt?: string;
  location: string;
  cuisineType: string;
  preferredSuppliers: string[];
  monthlyBudgetTarget: number | null;
  savingsTargetPct: number | null;
  createdAt: string;
};

export type ProcurementRecord = {
  id: string;
  date: string;
  tenantId: string;
  restaurantName: string;
  menuText?: string;
  recipesCount: number;
  ingredientsCount: number;
  distributorsCount: number;
  quotesCount: number;
  totalSpend?: number;
  winner?: string;
  winnerPrice?: number;
  totalSavings?: number;
  savingsPercentage?: number;
  executiveSummary?: string;
  marketAlerts?: string[];
};

export type ActiveRFP = {
  id: string;
  date: string;
  tenantId: string;
  restaurantName: string;
  ingredientsCount: number;
  distributorsCount: number;
  quotesCount: number;
  status: string;
};

export const ACCOUNT_KEY = 'autorfp_account';
const ACCOUNT_REGISTRY_KEY = 'autorfp_accounts';

export function makeTenantId(email: string, restaurantName: string) {
  const seed = `${email.trim().toLowerCase()}::${restaurantName.trim().toLowerCase()}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  return `tenant_${Math.abs(hash).toString(36)}`;
}

export function parseSuppliers(value: string) {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function supplierListToText(value: string[]) {
  return value.join(', ');
}

export function accountFromForm(input: {
  name: string;
  email: string;
  location: string;
  cuisineType?: string;
  preferredSuppliers?: string[];
  monthlyBudgetTarget?: number | null;
  savingsTargetPct?: number | null;
  passwordHash?: string;
  passwordSalt?: string;
}): RestaurantAccount {
  const existing = readAccount();
  const email = input.email.trim();
  const name = input.name.trim();
  return {
    tenantId: existing?.tenantId ?? makeTenantId(email, name),
    name,
    email,
    passwordHash: input.passwordHash ?? existing?.passwordHash,
    passwordSalt: input.passwordSalt ?? existing?.passwordSalt,
    location: input.location.trim(),
    cuisineType: input.cuisineType?.trim() || 'General restaurant',
    preferredSuppliers: input.preferredSuppliers ?? [],
    monthlyBudgetTarget: input.monthlyBudgetTarget ?? null,
    savingsTargetPct: input.savingsTargetPct ?? null,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}

export function readAccount(): RestaurantAccount | null {
  if (typeof window === 'undefined') return null;
  const saved = localStorage.getItem(ACCOUNT_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    const tenantId = parsed.tenantId || makeTenantId(parsed.email ?? '', parsed.name ?? '');
    const account = {
      tenantId,
      name: parsed.name ?? '',
      email: parsed.email ?? '',
      passwordHash: parsed.passwordHash,
      passwordSalt: parsed.passwordSalt,
      location: parsed.location ?? '',
      cuisineType: parsed.cuisineType ?? 'General restaurant',
      preferredSuppliers: Array.isArray(parsed.preferredSuppliers) ? parsed.preferredSuppliers : [],
      monthlyBudgetTarget: typeof parsed.monthlyBudgetTarget === 'number' ? parsed.monthlyBudgetTarget : null,
      savingsTargetPct: typeof parsed.savingsTargetPct === 'number' ? parsed.savingsTargetPct : null,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    };
    const registry = readAccountRegistry();
    if (!registry[tenantId]) {
      localStorage.setItem(ACCOUNT_REGISTRY_KEY, JSON.stringify({ ...registry, [tenantId]: account }));
    }
    return account;
  } catch {
    return null;
  }
}

export function saveAccount(account: RestaurantAccount) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  const registry = readAccountRegistry();
  localStorage.setItem(ACCOUNT_REGISTRY_KEY, JSON.stringify({
    ...registry,
    [account.tenantId]: account,
  }));
  migrateLegacyTenantState(account.tenantId);
}

export function readAccountRegistry(): Record<string, RestaurantAccount> {
  if (typeof window === 'undefined') return {};
  const saved = localStorage.getItem(ACCOUNT_REGISTRY_KEY);
  if (!saved) return {};
  try { return JSON.parse(saved); } catch { return {}; }
}

export function findSavedAccount(email: string, restaurantName: string) {
  const tenantId = makeTenantId(email, restaurantName);
  return readAccountRegistry()[tenantId] ?? null;
}

export function findSavedAccountByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return Object.values(readAccountRegistry()).find(account => account.email.trim().toLowerCase() === normalized) ?? null;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(digest));
}

export async function createPasswordRecord(password: string) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const body = new TextEncoder().encode(password);
  const combined = new Uint8Array(salt.length + body.length);
  combined.set(salt);
  combined.set(body, salt.length);
  return {
    passwordSalt: bytesToHex(salt),
    passwordHash: await sha256Hex(combined),
  };
}

export async function verifyPassword(password: string, account: RestaurantAccount) {
  if (!account.passwordHash || !account.passwordSalt) return false;
  const salt = hexToBytes(account.passwordSalt);
  const body = new TextEncoder().encode(password);
  const combined = new Uint8Array(salt.length + body.length);
  combined.set(salt);
  combined.set(body, salt.length);
  return await sha256Hex(combined) === account.passwordHash;
}

export function tenantKey(tenantId: string, name: 'history' | 'active_rfp' | 'run_again') {
  return `autorfp:${tenantId}:${name}`;
}

export function readTenantHistory(tenantId: string): ProcurementRecord[] {
  const raw = localStorage.getItem(tenantKey(tenantId, 'history'));
  if (raw) {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

export function writeTenantHistory(tenantId: string, records: ProcurementRecord[]) {
  localStorage.setItem(tenantKey(tenantId, 'history'), JSON.stringify(records));
}

export function readActiveRfp(tenantId: string): ActiveRFP | null {
  const raw = localStorage.getItem(tenantKey(tenantId, 'active_rfp'));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function writeActiveRfp(tenantId: string, rfp: ActiveRFP) {
  localStorage.setItem(tenantKey(tenantId, 'active_rfp'), JSON.stringify(rfp));
}

export function clearActiveRfp(tenantId: string) {
  localStorage.removeItem(tenantKey(tenantId, 'active_rfp'));
}

export function migrateLegacyTenantState(tenantId: string) {
  const tenantHistoryKey = tenantKey(tenantId, 'history');
  if (!localStorage.getItem(tenantHistoryKey)) {
    const legacyHistory = localStorage.getItem('autorfp_history');
    if (legacyHistory) localStorage.setItem(tenantHistoryKey, legacyHistory);
  }

  const tenantActiveKey = tenantKey(tenantId, 'active_rfp');
  if (!localStorage.getItem(tenantActiveKey)) {
    const legacyActive = localStorage.getItem('autorfp_active_rfp');
    if (legacyActive) localStorage.setItem(tenantActiveKey, legacyActive);
  }
}
