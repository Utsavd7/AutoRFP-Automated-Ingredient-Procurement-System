type PilotEnvironment = {
  DATABASE_URL?: string;
  NEXTAUTH_URL?: string;
  NODE_ENV?: string;
  QUOTEPLATE_LOCAL_E2E?: string;
  QUOTEPLATE_PILOT_EMAILS?: string;
};

const MAXIMUM_PILOT_OWNERS = 20;

function hasLoopbackUrl(value: string | undefined, protocols: string[]) {
  if (!value?.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.toLowerCase();
    return protocols.includes(parsed.protocol) && (
      hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.')
    );
  } catch {
    return false;
  }
}

export function localPilotTestModeAllowed(environment: PilotEnvironment) {
  return (
    environment.NODE_ENV === 'production' &&
    environment.QUOTEPLATE_LOCAL_E2E === '1' &&
    hasLoopbackUrl(environment.NEXTAUTH_URL, ['http:', 'https:']) &&
    hasLoopbackUrl(environment.DATABASE_URL, ['postgres:', 'postgresql:'])
  );
}

export function configuredPilotEmails(environment: PilotEnvironment) {
  const entries = (environment.QUOTEPLATE_PILOT_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (
    entries.length === 0 ||
    entries.length > MAXIMUM_PILOT_OWNERS ||
    new Set(entries).size !== entries.length ||
    entries.some((entry) => entry.length > 320 || !/^\S+@\S+\.\S+$/.test(entry))
  ) {
    return null;
  }
  return new Set(entries);
}

export function pilotEmailAllowed(
  email: unknown,
  environment: PilotEnvironment = process.env,
) {
  if (environment.NODE_ENV !== 'production') return true;
  if (localPilotTestModeAllowed(environment)) return true;
  if (typeof email !== 'string') return false;
  const configured = configuredPilotEmails(environment);
  return configured?.has(email.trim().toLowerCase()) ?? false;
}

export function productionEmailOwnerSignupAllowed(
  environment: PilotEnvironment = process.env,
) {
  return environment.NODE_ENV !== 'production' || localPilotTestModeAllowed(environment);
}
