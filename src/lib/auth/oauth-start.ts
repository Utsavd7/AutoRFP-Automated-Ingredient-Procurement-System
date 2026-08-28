import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

import { validGoogleSignupFlowId } from '@/lib/auth/google-flow';

export const GOOGLE_ONBOARDING_COOKIE = 'autorfp.google-onboarding';
export const GOOGLE_ONBOARDING_MAX_AGE_SECONDS = 10 * 60;
export const GOOGLE_ONBOARDING_COOKIE_MAX_BYTES = 3_800;

const GOOGLE_ONBOARDING_CALLBACK_PATH = '/api/auth/callback/google';
const GOOGLE_ONBOARDING_OVERSIZE_ERROR =
  'Workspace details are too long for Google sign up. Shorten the restaurant name or address.';
const MAX_OAUTH_STATE_LENGTH = 128;

const COOKIE_KEY_DOMAIN = 'autorfp.google-onboarding.v1';

export class GoogleOnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleOnboardingError';
  }
}

export type GoogleOnboardingInput = {
  restaurantName: string;
  ownerName: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  phone: string;
  timezone?: string;
  gstin?: string | null;
};

export type GoogleOnboarding = Required<
  Omit<GoogleOnboardingInput, 'gstin' | 'timezone'>
> & {
  timezone: string;
  gstin: string | null;
  expiresAt: string;
};

type GoogleOnboardingCookiePayload = GoogleOnboarding & {
  flowId: string;
};

type CryptoOptions = {
  secret: string;
  now?: Date;
  expectedFlowId?: string;
};

type GoogleOnboardingCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: string;
    maxAge: number;
  };
};

function encryptionKey(secret: string) {
  return createHmac('sha256', secret).update(COOKIE_KEY_DOMAIN).digest();
}

function required(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) throw new GoogleOnboardingError(`${field} is required.`);
  if (normalized.length > maxLength) {
    throw new GoogleOnboardingError(`${field} is too long.`);
  }
  return normalized;
}

export function normalizeGoogleOnboarding(
  input: GoogleOnboardingInput,
  now = new Date(),
): GoogleOnboarding {
  const email = required(input.email, 'Email', 320).toLowerCase();
  const pin = required(input.pin, 'PIN', 6);
  const gstin = input.gstin?.trim().toUpperCase() || null;
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new GoogleOnboardingError('Enter a valid work email.');
  }
  if (!/^\d{6}$/.test(pin)) {
    throw new GoogleOnboardingError('Enter a valid 6-digit PIN.');
  }
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) {
    throw new GoogleOnboardingError('Enter a valid GSTIN or leave it blank.');
  }

  return {
    restaurantName: required(input.restaurantName, 'Restaurant name', 200),
    ownerName: required(input.ownerName, 'Owner name', 200),
    email,
    addressLine: required(input.addressLine, 'Address', 500),
    city: required(input.city, 'City', 120),
    state: required(input.state, 'State', 120),
    pin,
    phone: required(input.phone, 'Phone', 32),
    timezone: required(input.timezone || 'Asia/Kolkata', 'Timezone', 64),
    gstin,
    expiresAt: new Date(
      now.getTime() + GOOGLE_ONBOARDING_MAX_AGE_SECONDS * 1_000,
    ).toISOString(),
  };
}

export function googleOnboardingPendingCookieName(flowId: unknown) {
  return validGoogleSignupFlowId(flowId)
    ? `${GOOGLE_ONBOARDING_COOKIE}.${flowId}`
    : null;
}

export function googleOnboardingOAuthCookieName(state: unknown) {
  return typeof state === 'string' &&
    state.length >= 8 &&
    state.length <= MAX_OAUTH_STATE_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(state)
    ? `${GOOGLE_ONBOARDING_COOKIE}.oauth.${state}`
    : null;
}

export function googleOnboardingCookieHeader(cookie: GoogleOnboardingCookie) {
  const { options } = cookie;
  return `${cookie.name}=${cookie.value}; Path=${options.path}; Max-Age=${options.maxAge}; HttpOnly; SameSite=Lax${options.secure ? '; Secure' : ''}`;
}

function assertSafeCookieSize(value: string) {
  const worstCaseCookie: GoogleOnboardingCookie = {
    name: `${GOOGLE_ONBOARDING_COOKIE}.oauth.${'s'.repeat(MAX_OAUTH_STATE_LENGTH)}`,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: GOOGLE_ONBOARDING_CALLBACK_PATH,
      maxAge: GOOGLE_ONBOARDING_MAX_AGE_SECONDS,
    },
  };
  if (
    Buffer.byteLength(googleOnboardingCookieHeader(worstCaseCookie), 'utf8') >
    GOOGLE_ONBOARDING_COOKIE_MAX_BYTES
  ) {
    throw new GoogleOnboardingError(GOOGLE_ONBOARDING_OVERSIZE_ERROR);
  }
}

export function createGoogleOnboardingCookie(
  input: GoogleOnboardingInput,
  options: CryptoOptions & { secure: boolean; flowId?: string },
) {
  const flowId = options.flowId ?? randomBytes(18).toString('base64url');
  const name = googleOnboardingPendingCookieName(flowId);
  if (!name) {
    throw new GoogleOnboardingError('Unable to start Google sign up.');
  }
  const payload: GoogleOnboardingCookiePayload = {
    ...normalizeGoogleOnboarding(input, options.now),
    flowId,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(options.secret), iv);
  cipher.setAAD(Buffer.from(COOKIE_KEY_DOMAIN));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const value = ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), authTag.toString('base64url')].join('.');
  assertSafeCookieSize(value);

  return {
    flowId,
    name,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: options.secure,
      path: '/api/auth',
      maxAge: GOOGLE_ONBOARDING_MAX_AGE_SECONDS,
    },
  };
}

export function readGoogleOnboardingCookie(
  value: string | null | undefined,
  options: CryptoOptions,
): GoogleOnboarding | null {
  if (!value) return null;
  const [version, encodedIv, encodedCiphertext, encodedAuthTag, extra] =
    value.split('.');
  if (
    version !== 'v1' ||
    !encodedIv ||
    !encodedCiphertext ||
    !encodedAuthTag ||
    extra
  ) {
    return null;
  }

  try {
    const iv = Buffer.from(encodedIv, 'base64url');
    const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
    const authTag = Buffer.from(encodedAuthTag, 'base64url');
    if (
      iv.toString('base64url') !== encodedIv ||
      ciphertext.toString('base64url') !== encodedCiphertext ||
      authTag.toString('base64url') !== encodedAuthTag
    ) {
      return null;
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(options.secret),
      iv,
    );
    decipher.setAAD(Buffer.from(COOKIE_KEY_DOMAIN));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext) as GoogleOnboardingCookiePayload;
    const now = options.now ?? new Date();
    if (
      !validGoogleSignupFlowId(payload.flowId) ||
      (options.expectedFlowId && payload.flowId !== options.expectedFlowId) ||
      !payload.expiresAt ||
      new Date(payload.expiresAt).getTime() <= now.getTime()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createGoogleOnboardingOAuthCookie(
  value: string,
  state: string,
  options: CryptoOptions & { secure: boolean; expectedFlowId: string },
): GoogleOnboardingCookie | null {
  const name = googleOnboardingOAuthCookieName(state);
  if (
    !name ||
    !readGoogleOnboardingCookie(value, {
      secret: options.secret,
      now: options.now,
      expectedFlowId: options.expectedFlowId,
    })
  ) {
    return null;
  }
  return {
    name,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: options.secure,
      path: GOOGLE_ONBOARDING_CALLBACK_PATH,
      maxAge: GOOGLE_ONBOARDING_MAX_AGE_SECONDS,
    },
  };
}

export function expiredGoogleOnboardingCookie(
  name: string,
  path: string,
  secure: boolean,
): GoogleOnboardingCookie {
  return {
    name,
    value: '',
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure,
      path,
      maxAge: 0,
    },
  };
}
