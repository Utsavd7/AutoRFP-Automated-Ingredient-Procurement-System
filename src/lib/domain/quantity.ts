import {
  assertMaximum,
  ExactDecimalInput,
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  parseUnsignedFixed,
} from './validation';

export type ProcurementUnit =
  | 'KILOGRAM'
  | 'GRAM'
  | 'LITRE'
  | 'MILLILITRE'
  | 'PIECE'
  | 'PACK'
  | 'CASE'
  | 'CRATE';

const UNIT_ALIASES: Readonly<Record<string, ProcurementUnit>> = {
  kg: 'KILOGRAM',
  kgs: 'KILOGRAM',
  kilogram: 'KILOGRAM',
  kilograms: 'KILOGRAM',
  g: 'GRAM',
  gram: 'GRAM',
  grams: 'GRAM',
  l: 'LITRE',
  litre: 'LITRE',
  litres: 'LITRE',
  liter: 'LITRE',
  liters: 'LITRE',
  ml: 'MILLILITRE',
  millilitre: 'MILLILITRE',
  millilitres: 'MILLILITRE',
  milliliter: 'MILLILITRE',
  milliliters: 'MILLILITRE',
  pc: 'PIECE',
  pcs: 'PIECE',
  piece: 'PIECE',
  pieces: 'PIECE',
  pack: 'PACK',
  packs: 'PACK',
  case: 'CASE',
  cases: 'CASE',
  crate: 'CRATE',
  crates: 'CRATE',
};

export function normalizeUnit(input: string): ProcurementUnit {
  if (typeof input !== 'string') {
    throw new TypeError('Unit must be text');
  }

  const normalized = UNIT_ALIASES[input.trim().toLowerCase()];
  if (!normalized) {
    throw new TypeError(`Unsupported procurement unit: ${input}`);
  }

  return normalized;
}

export function parseQuantityToMilli(input: ExactDecimalInput): bigint {
  return parseUnsignedFixed(input, {
    label: 'Quantity',
    scale: 3,
    maximumScaled: MAX_DECIMAL_18_3_SCALED,
    allowZero: false,
  });
}

export function formatQuantity(quantityMilli: bigint): string {
  assertMaximum(quantityMilli, MAX_DECIMAL_18_3_SCALED, 'Quantity');
  if (quantityMilli === BigInt(0)) {
    throw new RangeError('Quantity must be positive');
  }

  return formatScaledDecimal(quantityMilli, 3);
}
