const LOCAL_ORIGIN = 'http://localhost:3000';
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

type InvitationEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveInvitationOrigin(
  environment: InvitationEnvironment = process.env,
) {
  const production = environment.NODE_ENV === 'production';
  const configured = environment.NEXTAUTH_URL?.trim();
  if (production && !configured) {
    throw new TypeError(
      'NEXTAUTH_URL must be configured for production invitation links.',
    );
  }

  const url = new URL(configured || LOCAL_ORIGIN);
  if (url.username || url.password) {
    throw new TypeError('The invitation origin cannot contain credentials.');
  }
  if (url.protocol !== 'https:') {
    if (production || url.protocol !== 'http:' || !localHosts.has(url.hostname)) {
      throw new TypeError('Invitation links require HTTPS outside local development.');
    }
  }

  return new URL(url.origin);
}
