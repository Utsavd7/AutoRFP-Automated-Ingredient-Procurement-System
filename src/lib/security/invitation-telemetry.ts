const invitationToken = /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?=[^A-Za-z0-9_-]|$)/;
const invitationPath = /\/join\/[A-Za-z0-9_-]{43}(?:[^A-Za-z0-9_-]|$)/;
const acceptancePath = /\/api\/invitations\/accept(?:[^A-Za-z0-9_-]|$)/;

function serialized(value: unknown) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function containsInvitationData(value: unknown) {
  const text = typeof value === 'string' ? value : serialized(value);
  return (
    invitationPath.test(text) ||
    acceptancePath.test(text) ||
    invitationToken.test(text)
  );
}

export function filterInvitationTelemetry<T>(payload: T): T | null {
  return containsInvitationData(payload) ? null : payload;
}

export function shouldSampleInvitationTrace(context: unknown) {
  return !containsInvitationData(context);
}
