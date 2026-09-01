import { calculateGst, multiplyPaise } from '@/lib/domain/money';
import {
  assertMaximum,
  formatScaledDecimal,
  MAX_DECIMAL_18_3_SCALED,
  MAX_SIGNED_BIGINT,
  parseUnsignedFixed,
} from '@/lib/domain/validation';

type PreviewRequestItem = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
};

type PreviewQuoteItem = {
  requestItemId: string;
  normalizedAvailableQuantity: string | null;
  normalizedUnitRatePaise: string | null;
  gstBasisPoints: number | null;
  taxInclusive: boolean;
  unitComparable: boolean;
};

type PreviewQuote = {
  supplierRequestId: string;
  quoteRevision: number;
  supplierName: string;
  freightPaise: string;
  expired: boolean;
  supplierActive?: boolean;
  awardable?: boolean;
  items: PreviewQuoteItem[];
};

export type SplitAllocation = {
  supplierRequestId: string;
  quoteRevision: number;
  quantity: string;
};

export function cappedAllocationQuantity(remaining: string, available: string) {
  const remainingMilli = quantityMilli(remaining);
  const availableMilli = quantityMilli(available);
  return formatScaledDecimal(
    remainingMilli < availableMilli ? remainingMilli : availableMilli,
    3,
  );
}

function unitLabel(unit: string) {
  return ({
    KILOGRAM: 'kg', GRAM: 'g', LITRE: 'L', MILLILITRE: 'ml', PIECE: 'piece',
    PACK: 'pack', CASE: 'case', CRATE: 'crate',
  } as Record<string, string>)[unit] ?? unit.toLowerCase();
}

function quantityMilli(value: string, allowZero = false) {
  return parseUnsignedFixed(value, {
    label: 'Award quantity',
    scale: 3,
    maximumScaled: MAX_DECIMAL_18_3_SCALED,
    allowZero,
  });
}

export function calculateSplitAwardPreview(input: {
  requestItems: PreviewRequestItem[];
  quotes: PreviewQuote[];
  allocations: Record<string, SplitAllocation[]>;
}) {
  const errors: string[] = [];
  const quoteItems = new Map<string, { quote: PreviewQuote; item: PreviewQuoteItem }>();
  for (const quote of input.quotes) {
    for (const item of quote.items) {
      quoteItems.set(
        `${item.requestItemId}\u0000${quote.supplierRequestId}\u0000${quote.quoteRevision}`,
        { quote, item },
      );
    }
  }

  let subtotalPaise = BigInt(0);
  let gstPaise = BigInt(0);
  let lineTotalPaise = BigInt(0);
  const selectedQuotes = new Map<string, PreviewQuote>();
  const selections: Array<{
    requestItemId: string;
    supplierRequestId: string;
    quoteRevision: number;
    quantity: string;
  }> = [];
  const itemCoverage: Record<string, {
    requested: string;
    allocated: string;
    remaining: string;
    valid: boolean;
  }> = {};

  for (const requestItem of input.requestItems) {
    const requested = quantityMilli(requestItem.quantity);
    let allocated = BigInt(0);
    const seen = new Set<string>();
    for (const allocation of input.allocations[requestItem.id] ?? []) {
      if (!allocation.quantity) continue;
      const allocationKey = `${requestItem.id}\u0000${allocation.supplierRequestId}\u0000${allocation.quoteRevision}`;
      const match = quoteItems.get(allocationKey);
      if (!match || seen.has(allocationKey)) {
        errors.push(`Choose a valid, unique supplier line for ${requestItem.name}.`);
        continue;
      }
      seen.add(allocationKey);
      if (
        match.quote.expired ||
        match.quote.supplierActive === false ||
        match.quote.awardable === false
      ) {
        errors.push(`${match.quote.supplierName} is not available for an award.`);
        continue;
      }
      if (
        !match.item.unitComparable ||
        match.item.normalizedAvailableQuantity === null ||
        match.item.normalizedUnitRatePaise === null ||
        match.item.gstBasisPoints === null
      ) {
        errors.push(`${match.quote.supplierName}'s line for ${requestItem.name} cannot be compared.`);
        continue;
      }
      let quantity: bigint;
      let available: bigint;
      try {
        quantity = quantityMilli(allocation.quantity);
        available = quantityMilli(match.item.normalizedAvailableQuantity);
      } catch {
        errors.push(`Enter a valid quantity for ${requestItem.name}.`);
        continue;
      }
      if (quantity > available) {
        errors.push(
          `${match.quote.supplierName} can supply at most ${formatScaledDecimal(available, 3)} ${unitLabel(requestItem.unit)} for ${requestItem.name}.`,
        );
        continue;
      }
      try {
        const amount = multiplyPaise(match.item.normalizedUnitRatePaise, allocation.quantity);
        const gst = calculateGst({
          amountPaise: amount,
          gstBasisPoints: match.item.gstBasisPoints,
          inclusive: match.item.taxInclusive,
        });
        subtotalPaise = assertMaximum(subtotalPaise + gst.netPaise, MAX_SIGNED_BIGINT, 'Award subtotal');
        gstPaise = assertMaximum(gstPaise + gst.gstPaise, MAX_SIGNED_BIGINT, 'Award GST');
        lineTotalPaise = assertMaximum(lineTotalPaise + gst.grossPaise, MAX_SIGNED_BIGINT, 'Award lines');
      } catch {
        errors.push(`The amount for ${requestItem.name} is outside the supported range.`);
        continue;
      }
      allocated = assertMaximum(allocated + quantity, MAX_DECIMAL_18_3_SCALED, 'Award coverage');
      selectedQuotes.set(
        `${match.quote.supplierRequestId}\u0000${match.quote.quoteRevision}`,
        match.quote,
      );
      selections.push({
        requestItemId: requestItem.id,
        supplierRequestId: match.quote.supplierRequestId,
        quoteRevision: match.quote.quoteRevision,
        quantity: formatScaledDecimal(quantity, 3),
      });
    }
    const remaining = requested > allocated ? requested - allocated : BigInt(0);
    if (allocated > requested) errors.push(`${requestItem.name} is over-allocated.`);
    itemCoverage[requestItem.id] = {
      requested: formatScaledDecimal(requested, 3),
      allocated: formatScaledDecimal(allocated, 3),
      remaining: formatScaledDecimal(remaining, 3),
      valid: allocated === requested,
    };
  }

  let freightPaise = BigInt(0);
  for (const quote of selectedQuotes.values()) {
    try {
      freightPaise = assertMaximum(
        freightPaise + BigInt(quote.freightPaise),
        MAX_SIGNED_BIGINT,
        'Award freight',
      );
    } catch {
      errors.push(`The freight from ${quote.supplierName} is outside the supported range.`);
    }
  }
  let totalPaise = BigInt(0);
  try {
    totalPaise = assertMaximum(lineTotalPaise + freightPaise, MAX_SIGNED_BIGINT, 'Award total');
  } catch {
    errors.push('The final award total is outside the supported range.');
  }

  return {
    ready:
      errors.length === 0 &&
      input.requestItems.length > 0 &&
      input.requestItems.every((item) => itemCoverage[item.id]?.valid) &&
      selections.length > 0,
    errors,
    itemCoverage,
    selections,
    selectedSupplierRequestIds: [...selectedQuotes.values()]
      .map(({ supplierRequestId }) => supplierRequestId)
      .sort(),
    subtotalPaise: subtotalPaise.toString(),
    gstPaise: gstPaise.toString(),
    freightPaise: freightPaise.toString(),
    totalPaise: totalPaise.toString(),
  };
}
