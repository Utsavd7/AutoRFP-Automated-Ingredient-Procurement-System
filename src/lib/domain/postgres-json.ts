const INVALID_JSON_MESSAGE = 'Value must be valid JSON for PostgreSQL jsonb serialization.';
const MAX_JSON_NESTING_DEPTH = 100;

function invalidJson(detail?: string): never {
  throw new TypeError(detail ? `${INVALID_JSON_MESSAGE} ${detail}` : INVALID_JSON_MESSAGE);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

function postgresNumberText(value: number): string {
  const json = JSON.stringify(value);
  if (json === undefined || !Number.isFinite(value)) invalidJson();

  const scientific = /^(-?)(\d)(?:\.(\d+))?e([+-]?\d+)$/i.exec(json);
  if (!scientific) return json;

  const sign = scientific[1];
  const digits = scientific[2] + (scientific[3] ?? '');
  const decimalPosition = 1 + Number(scientific[4]);

  if (decimalPosition <= 0) {
    return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`;
  }
  if (decimalPosition >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  }

  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function serializeString(value: string): string {
  if (value.includes('\u0000') || hasUnpairedSurrogate(value)) invalidJson();
  return JSON.stringify(value);
}

function serializeArray(value: unknown[], active: WeakSet<object>, depth: number): string {
  if (Object.getPrototypeOf(value) !== Array.prototype || active.has(value)) invalidJson();

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some(
      (key) =>
        key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length),
    )
  ) {
    invalidJson();
  }

  active.add(value);
  const entries: string[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) invalidJson();
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) invalidJson();
      entries.push(postgresJsonText(descriptor.value, active, depth + 1));
    }
  } finally {
    active.delete(value);
  }

  return `[${entries.join(', ')}]`;
}

function serializeObject(value: object, active: WeakSet<object>, depth: number): string {
  if (Object.getPrototypeOf(value) !== Object.prototype || active.has(value)) invalidJson();

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) invalidJson();

  active.add(value);
  const entries: string[] = [];
  try {
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) invalidJson();
      entries.push(
        `${serializeString(key)}: ${postgresJsonText(descriptor.value, active, depth + 1)}`,
      );
    }
  } finally {
    active.delete(value);
  }

  return `{${entries.join(', ')}}`;
}

function postgresJsonText(value: unknown, active: WeakSet<object>, depth: number): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return postgresNumberText(value);
  if (typeof value === 'string') return serializeString(value);
  if (Array.isArray(value) || typeof value === 'object') {
    if (depth >= MAX_JSON_NESTING_DEPTH) {
      invalidJson(`JSON nesting cannot exceed ${MAX_JSON_NESTING_DEPTH} levels.`);
    }
    return Array.isArray(value)
      ? serializeArray(value, active, depth)
      : serializeObject(value, active, depth);
  }
  return invalidJson();
}

export function postgresJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(postgresJsonText(value, new WeakSet(), 0)).byteLength;
}

export function assertBoundedJson(
  value: unknown,
  maximumBytes: number,
  label = 'JSON document',
): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError('JSON byte limit must be a positive integer.');
  }

  if (postgresJsonByteLength(value) > maximumBytes) {
    throw new RangeError(`${label} exceeds its ${maximumBytes}-byte JSON limit.`);
  }
}
