const INVALID_JSON_MESSAGE = 'Value must be valid JSON for PostgreSQL jsonb serialization.';

type JsonWorkItem =
  | { kind: 'value'; value: unknown }
  | { kind: 'text'; value: string }
  | { kind: 'leave'; value: object };

function invalidJson(): never {
  throw new TypeError(INVALID_JSON_MESSAGE);
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
  if (decimalPosition <= 0) return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function serializeString(value: string): string {
  if (value.includes('\u0000') || hasUnpairedSurrogate(value)) invalidJson();
  return JSON.stringify(value);
}

function postgresJsonText(root: unknown): string {
  const active = new WeakSet<object>();
  const output: string[] = [];
  const work: JsonWorkItem[] = [{ kind: 'value', value: root }];

  while (work.length > 0) {
    const item = work.pop()!;
    if (item.kind === 'text') {
      output.push(item.value);
      continue;
    }
    if (item.kind === 'leave') {
      active.delete(item.value);
      continue;
    }

    const value = item.value;
    if (value === null) {
      output.push('null');
    } else if (typeof value === 'boolean') {
      output.push(value ? 'true' : 'false');
    } else if (typeof value === 'number') {
      output.push(postgresNumberText(value));
    } else if (typeof value === 'string') {
      output.push(serializeString(value));
    } else if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || active.has(value)) invalidJson();
      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            key !== 'length' &&
            (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length),
        )
      ) {
        invalidJson();
      }

      active.add(value);
      output.push('[');
      work.push({ kind: 'leave', value }, { kind: 'text', value: ']' });
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) invalidJson();
        work.push({ kind: 'value', value: descriptor.value });
        if (index > 0) work.push({ kind: 'text', value: ', ' });
      }
    } else if (typeof value === 'object') {
      if (Object.getPrototypeOf(value) !== Object.prototype || active.has(value)) invalidJson();
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== 'string')) invalidJson();

      active.add(value);
      output.push('{');
      work.push({ kind: 'leave', value }, { kind: 'text', value: '}' });
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index] as string;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) invalidJson();
        work.push({ kind: 'value', value: descriptor.value });
        work.push({ kind: 'text', value: `${serializeString(key)}: ` });
        if (index > 0) work.push({ kind: 'text', value: ', ' });
      }
    } else {
      invalidJson();
    }
  }

  return output.join('');
}

export function postgresJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(postgresJsonText(value)).byteLength;
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
