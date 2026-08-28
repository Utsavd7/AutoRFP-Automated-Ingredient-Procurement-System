import {
  assertMaximum,
  divideExactly,
  ExactDecimalInput,
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  parseUnsignedFixed,
} from './validation';

export const PROCUREMENT_UNITS = [
  'KILOGRAM',
  'GRAM',
  'LITRE',
  'MILLILITRE',
  'PIECE',
  'PACK',
  'CASE',
  'CRATE',
] as const;

export type ProcurementUnit = (typeof PROCUREMENT_UNITS)[number];

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

const CONTAINER_UNITS = new Set<ProcurementUnit>(['PACK', 'CASE', 'CRATE']);
const STANDARD_UNITS: Readonly<
  Record<
    Exclude<ProcurementUnit, 'PACK' | 'CASE' | 'CRATE'>,
    { dimension: 'MASS' | 'VOLUME' | 'COUNT'; baseFactor: bigint }
  >
> = {
  KILOGRAM: { dimension: 'MASS', baseFactor: BigInt(1_000) },
  GRAM: { dimension: 'MASS', baseFactor: BigInt(1) },
  LITRE: { dimension: 'VOLUME', baseFactor: BigInt(1_000) },
  MILLILITRE: { dimension: 'VOLUME', baseFactor: BigInt(1) },
  PIECE: { dimension: 'COUNT', baseFactor: BigInt(1) },
};

function isContainer(unit: ProcurementUnit): boolean {
  return CONTAINER_UNITS.has(unit);
}

function standardUnit(unit: ProcurementUnit) {
  return STANDARD_UNITS[unit as keyof typeof STANDARD_UNITS];
}

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

export function convertQuantity(
  quantityInput: ExactDecimalInput,
  fromUnitInput: string,
  toUnitInput: string,
  packQuantityInput?: ExactDecimalInput,
): string {
  const quantity = parseQuantityToMilli(quantityInput);
  const fromUnit = normalizeUnit(fromUnitInput);
  const toUnit = normalizeUnit(toUnitInput);

  if (fromUnit === toUnit) {
    return formatQuantity(quantity);
  }

  const fromIsContainer = isContainer(fromUnit);
  const toIsContainer = isContainer(toUnit);

  if (fromIsContainer || toIsContainer) {
    if (fromIsContainer && toIsContainer) {
      throw new TypeError('Container-to-container conversion is ambiguous');
    }
    if (packQuantityInput === undefined) {
      throw new TypeError('Container conversion requires an explicit pack quantity');
    }

    const packQuantity = parseQuantityToMilli(packQuantityInput);
    const converted = fromIsContainer
      ? divideExactly(quantity * packQuantity, BigInt(1_000), 'Container conversion')
      : divideExactly(quantity * BigInt(1_000), packQuantity, 'Container conversion');

    return formatQuantity(
      assertMaximum(converted, MAX_DECIMAL_18_3_SCALED, 'Converted quantity'),
    );
  }

  const from = standardUnit(fromUnit);
  const to = standardUnit(toUnit);
  if (!from || !to || from.dimension !== to.dimension) {
    throw new TypeError(`Cannot convert ${fromUnit} to ${toUnit}`);
  }

  const converted = divideExactly(
    quantity * from.baseFactor,
    to.baseFactor,
    'Unit conversion',
  );

  return formatQuantity(
    assertMaximum(converted, MAX_DECIMAL_18_3_SCALED, 'Converted quantity'),
  );
}
