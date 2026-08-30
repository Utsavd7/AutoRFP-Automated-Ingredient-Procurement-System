import {
  assertMaximum,
  divideHalfUp,
  ExactDecimalInput,
  MAX_DECIMAL_18_3_SCALED,
  MAX_SIGNED_BIGINT,
  parseUnsignedFixed,
} from './validation';

export interface GstBreakdown {
  netPaise: bigint;
  gstPaise: bigint;
  grossPaise: bigint;
}

export interface GstInput {
  amountPaise: ExactDecimalInput;
  gstBasisPoints: number;
  inclusive: boolean;
}

function parsePaise(input: ExactDecimalInput, label: string): bigint {
  return parseUnsignedFixed(input, {
    label,
    scale: 0,
    maximumScaled: MAX_SIGNED_BIGINT,
    allowZero: true,
  });
}

function parseGstBasisPoints(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new RangeError('GST basis points must be an integer from 0 to 10000');
  }

  return BigInt(value);
}

export function parseInrToPaise(input: ExactDecimalInput): bigint {
  return parseUnsignedFixed(input, {
    label: 'INR amount',
    scale: 2,
    maximumScaled: MAX_SIGNED_BIGINT,
    allowZero: true,
  });
}

export function formatInr(input: ExactDecimalInput): string {
  const paise = parsePaise(input, 'Paise');
  const rupees = (paise / BigInt(100)).toString();
  const fraction = (paise % BigInt(100)).toString().padStart(2, '0');
  const lastThree = rupees.slice(-3);
  let leading = rupees.slice(0, -3);
  const groups: string[] = [];

  while (leading.length > 2) {
    groups.unshift(leading.slice(-2));
    leading = leading.slice(0, -2);
  }
  if (leading) groups.unshift(leading);
  groups.push(lastThree);

  return `₹${groups.join(',')}.${fraction}`;
}

export function multiplyPaise(
  unitPricePaiseInput: ExactDecimalInput,
  quantityInput: ExactDecimalInput,
): bigint {
  const unitPricePaise = parsePaise(unitPricePaiseInput, 'Unit price');
  const quantityMilli = parseUnsignedFixed(quantityInput, {
    label: 'Quantity',
    scale: 3,
    maximumScaled: MAX_DECIMAL_18_3_SCALED,
    allowZero: false,
  });
  const lineTotal = divideHalfUp(unitPricePaise * quantityMilli, BigInt(1_000));

  return assertMaximum(lineTotal, MAX_SIGNED_BIGINT, 'Line total');
}

export function calculateGst(input: GstInput): GstBreakdown {
  const amountPaise = parsePaise(input.amountPaise, 'Amount');
  const gstBasisPoints = parseGstBasisPoints(input.gstBasisPoints);

  if (input.inclusive) {
    const gstPaise = divideHalfUp(
      amountPaise * gstBasisPoints,
      BigInt(10_000) + gstBasisPoints,
    );

    return {
      netPaise: amountPaise - gstPaise,
      gstPaise,
      grossPaise: amountPaise,
    };
  }

  const gstPaise = divideHalfUp(amountPaise * gstBasisPoints, BigInt(10_000));
  const grossPaise = assertMaximum(
    amountPaise + gstPaise,
    MAX_SIGNED_BIGINT,
    'GST-inclusive amount',
  );

  return { netPaise: amountPaise, gstPaise, grossPaise };
}
