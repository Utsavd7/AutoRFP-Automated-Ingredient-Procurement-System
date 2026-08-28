import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

export const GOOGLE_ONBOARDING_COOKIE = 'autorfp.google-onboarding';
export const GOOGLE_ONBOARDING_MAX_AGE_SECONDS = 10 * 60;

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

type CryptoOptions = {
  secret: string;
  now?: Date;
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

export function createGoogleOnboardingCookie(
  input: GoogleOnboardingInput,
  options: CryptoOptions & { secure: boolean },
) {
  const payload = normalizeGoogleOnboarding(input, options.now);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(options.secret), iv);
  cipher.setAAD(Buffer.from(COOKIE_KEY_DOMAIN));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    name: GOOGLE_ONBOARDING_COOKIE,
    value: ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), authTag.toString('base64url')].join('.'),
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
    const payload = JSON.parse(plaintext) as GoogleOnboarding;
    const now = options.now ?? new Date();
    if (!payload.expiresAt || new Date(payload.expiresAt).getTime() <= now.getTime()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function expiredGoogleOnboardingCookie(secure: boolean) {
  return {
    name: GOOGLE_ONBOARDING_COOKIE,
    value: '',
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure,
      path: '/api/auth',
      maxAge: 0,
    },
  };
}
