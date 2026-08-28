import {
  configuredPilotEmails,
  localPilotTestModeAllowed,
} from '@/lib/auth/pilot-access';

type Environment = Readonly<Record<string, string | undefined>>;

export class EnvironmentConfigurationError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid production environment: ${variables.join(', ')}`);
    this.name = 'EnvironmentConfigurationError';
  }
}

function loopback(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.');
}

function parseUrl(
  value: string | undefined,
  variable: string,
  protocols: string[],
  issues: Set<string>,
) {
  if (!value?.trim()) {
    issues.add(variable);
    return null;
  }
  try {
    const parsed = new URL(value.trim());
    if (!protocols.includes(parsed.protocol)) {
      issues.add(variable);
      return null;
    }
    return parsed;
  } catch {
    issues.add(variable);
    return null;
  }
}

function requireRemoteTls(url: URL | null, variable: string, production: boolean, issues: Set<string>) {
  if (!url || !production || loopback(url.hostname)) return;
  if (!['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) {
    issues.add(variable);
  }
}

export function validateRuntimeEnvironment(environment: Environment = process.env) {
  const issues = new Set<string>();
  const production = environment.NODE_ENV === 'production';
  const databaseUrl = parseUrl(
    environment.DATABASE_URL,
    'DATABASE_URL',
    ['postgres:', 'postgresql:'],
    issues,
  );
  const siteUrl = parseUrl(
    environment.NEXTAUTH_URL,
    'NEXTAUTH_URL',
    ['http:', 'https:'],
    issues,
  );
  if (databaseUrl?.username === '') issues.add('DATABASE_URL');
  requireRemoteTls(databaseUrl, 'DATABASE_URL', production, issues);
  if (siteUrl && production && siteUrl.protocol !== 'https:' && !loopback(siteUrl.hostname)) {
    issues.add('NEXTAUTH_URL');
  }
  if ((environment.NEXTAUTH_SECRET?.trim().length ?? 0) < 32) {
    issues.add('NEXTAUTH_SECRET');
  }
  const googleClientId = environment.GOOGLE_CLIENT_ID?.trim() || undefined;
  const googleClientSecret = environment.GOOGLE_CLIENT_SECRET?.trim() || undefined;
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    issues.add(googleClientId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID');
  }
  const pilotEmails = configuredPilotEmails(environment);
  const localPilotTestMode = localPilotTestModeAllowed(environment);
  if (environment.QUOTEPLATE_LOCAL_E2E && !localPilotTestMode) {
    issues.add('QUOTEPLATE_LOCAL_E2E');
  }
  if (production && !pilotEmails && !localPilotTestMode) {
    issues.add('QUOTEPLATE_PILOT_EMAILS');
  }
  if (issues.size > 0 || !databaseUrl || !siteUrl) {
    throw new EnvironmentConfigurationError([...issues].sort());
  }
  return {
    databaseUrl: databaseUrl.toString(),
    siteUrl: siteUrl.toString(),
    nextAuthSecret: environment.NEXTAUTH_SECRET!.trim(),
    googleClientId,
    googleClientSecret,
    pilotEmails: pilotEmails ? [...pilotEmails] : [],
  };
}

export function validateMigrationEnvironment(environment: Environment = process.env) {
  const issues = new Set<string>();
  const production = environment.NODE_ENV === 'production';
  const directUrl = parseUrl(
    environment.DIRECT_URL,
    'DIRECT_URL',
    ['postgres:', 'postgresql:'],
    issues,
  );
  if (directUrl?.username === '') issues.add('DIRECT_URL');
  requireRemoteTls(directUrl, 'DIRECT_URL', production, issues);
  if (issues.size > 0 || !directUrl) {
    throw new EnvironmentConfigurationError([...issues].sort());
  }
  return { directUrl: directUrl.toString() };
}
