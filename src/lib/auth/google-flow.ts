export const GOOGLE_SIGNUP_FLOW_FIELD = 'autorfpSignupFlow';

export function validGoogleSignupFlowId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}
