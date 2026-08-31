const INVALID_JSON_MESSAGE = 'Value must be valid JSON for PostgreSQL jsonb serialization.';

type JsonWorkItem =
  | { kind: 'value'; value: unknown }
  | { kind: 'array'; value: unknown[]; index: number }
  | { kind: 'object'; value: object; keys: string[]; index: number };

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

function countPostgresJsonBytes(
  root: unknown,
  maximumBytes?: number,
  label = 'JSON document',
): number {
  const active = new WeakSet<object>();
  const encoder = new TextEncoder();
  const work: JsonWorkItem[] = [{ kind: 'value', value: root }];
  let bytes = 0;

  const addBytes = (amount: number) => {
    bytes += amount;
    if (maximumBytes !== undefined && bytes > maximumBytes) {
      throw new RangeError(`${label} exceeds its ${maximumBytes}-byte JSON limit.`);
    }
  };
  const addText = (text: string) => addBytes(encoder.encode(text).byteLength);

  while (work.length > 0) {
    const item = work.pop()!;
    if (item.kind === 'array') {
      if (item.index === item.value.length) {
        const keys = Reflect.ownKeys(item.value);
        if (
          keys.length !== item.value.length + 1 ||
          keys.some(
            (key) =>
              key !== 'length' &&
              (typeof key !== 'string' ||
                !/^(0|[1-9]\d*)$/.test(key) ||
                Number(key) >= item.value.length),
          )
        ) {
          invalidJson();
        }
        addBytes(1);
        active.delete(item.value);
        continue;
      }

      if (item.index > 0) addBytes(2);
      const descriptor = Object.getOwnPropertyDescriptor(item.value, String(item.index));
      if (!descriptor?.enumerable || !('value' in descriptor)) invalidJson();
      work.push(
        { ...item, index: item.index + 1 },
        { kind: 'value', value: descriptor.value },
      );
      continue;
    }

    if (item.kind === 'object') {
      if (item.index === item.keys.length) {
        addBytes(1);
        active.delete(item.value);
        continue;
      }

      if (item.index > 0) addBytes(2);
      const key = item.keys[item.index];
      addText(serializeString(key));
      addBytes(2);
      const descriptor = Object.getOwnPropertyDescriptor(item.value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) invalidJson();
      work.push(
        { ...item, index: item.index + 1 },
        { kind: 'value', value: descriptor.value },
      );
      continue;
    }

    const value = item.value;
    if (value === null) {
      addBytes(4);
    } else if (typeof value === 'boolean') {
      addBytes(value ? 4 : 5);
    } else if (typeof value === 'number') {
      addBytes(postgresNumberText(value).length);
    } else if (typeof value === 'string') {
      addText(serializeString(value));
    } else if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || active.has(value)) invalidJson();
      active.add(value);
      addBytes(1);
      work.push({ kind: 'array', value, index: 0 });
    } else if (typeof value === 'object') {
      if (Object.getPrototypeOf(value) !== Object.prototype || active.has(value)) invalidJson();
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== 'string')) invalidJson();
      active.add(value);
      addBytes(1);
      work.push({ kind: 'object', value, keys: keys as string[], index: 0 });
    } else {
      invalidJson();
    }
  }

  return bytes;
}

export function postgresJsonByteLength(value: unknown): number {
  return countPostgresJsonBytes(value);
}

export function assertBoundedJson(
  value: unknown,
  maximumBytes: number,
  label = 'JSON document',
): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError('JSON byte limit must be a positive integer.');
  }
  countPostgresJsonBytes(value, maximumBytes, label);
}
