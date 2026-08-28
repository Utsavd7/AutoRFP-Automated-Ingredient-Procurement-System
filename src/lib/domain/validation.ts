export interface DecimalStringable {
  toString(): string;
}

export type ExactDecimalInput = string | number | bigint | DecimalStringable;

export const MAX_SIGNED_BIGINT = BigInt('9223372036854775807');
export const MAX_DECIMAL_18_3_SCALED = BigInt('999999999999999999');

function decimalText(input: ExactDecimalInput, label: string): string {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) {
      throw new RangeError(`${label} must be supplied as an exact decimal string`);
    }

    return String(input);
  }

  if (typeof input === 'string' || typeof input === 'bigint') {
    return String(input);
  }

  if (input === null || typeof input !== 'object') {
    throw new TypeError(`${label} must be an exact decimal value`);
  }

  let value: string;
  try {
    value = input.toString();
  } catch {
    throw new TypeError(`${label} could not be read as a decimal value`);
  }

  return value;
}

function scaleFactor(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError('Decimal scale must be a non-negative integer');
  }

  return BigInt(`1${'0'.repeat(scale)}`);
}

export function parseUnsignedFixed(
  input: ExactDecimalInput,
  options: {
    label: string;
    scale: number;
    maximumScaled: bigint;
    allowZero: boolean;
  },
): bigint {
  const value = decimalText(input, options.label);
  const pattern =
    options.scale === 0
      ? /^(0|[1-9]\d*)$/
      : new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${options.scale}}))?$`);
  const match = pattern.exec(value);

  if (!match) {
    throw new TypeError(
      `${options.label} must be a non-negative decimal with at most ${options.scale} fractional digits`,
    );
  }

  const factor = scaleFactor(options.scale);
  const fraction = (match[2] ?? '').padEnd(options.scale, '0');
  const scaled = BigInt(match[1]) * factor + BigInt(fraction || '0');

  if ((!options.allowZero && scaled === BigInt(0)) || scaled > options.maximumScaled) {
    throw new RangeError(`${options.label} is outside the supported range`);
  }

  return scaled;
}

export function formatScaledDecimal(scaled: bigint, scale: number): string {
  if (scaled < BigInt(0)) {
    throw new RangeError('Scaled decimal cannot be negative');
  }

  const factor = scaleFactor(scale);
  const whole = scaled / factor;
  const fraction = (scaled % factor).toString().padStart(scale, '0').replace(/0+$/, '');

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) {
    throw new RangeError('Half-up division requires non-negative input and a positive divisor');
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  return remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;
}

export function divideExactly(
  numerator: bigint,
  denominator: bigint,
  label: string,
): bigint {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) {
    throw new RangeError(`${label} has invalid conversion inputs`);
  }

  if (numerator % denominator !== BigInt(0)) {
    throw new RangeError(`${label} cannot be represented with three decimal places`);
  }

  return numerator / denominator;
}

export function assertMaximum(value: bigint, maximum: bigint, label: string): bigint {
  if (value < BigInt(0) || value > maximum) {
    throw new RangeError(`${label} is outside the supported range`);
  }

  return value;
}
