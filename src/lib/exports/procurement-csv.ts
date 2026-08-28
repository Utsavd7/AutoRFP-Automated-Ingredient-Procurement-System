import { formatScaledDecimal } from '@/lib/domain/validation';
import { serializeCsv, type CsvValue } from '@/lib/exports/csv';

type RequestExport = {
  id: string;
  title: string;
  status: string;
  deliveryDate: string;
  quoteDeadline: string;
  deliveryDetails: {
    addressLine?: string;
    city?: string;
    state?: string;
    pin?: string;
    instructions?: string;
  };
  commercialTerms: string | null;
  items: Array<{ id: string; name: string; quantity: string; unit: string }>;
};

type QuoteItemExport = {
  requestItemId: string;
  requestItemName: string;
  quoteItemId: string | null;
  requestedQuantity: string;
  requestUnit: string;
  quotedAvailableQuantity: string | null;
  quotedUnit: string | null;
  normalizedUnitRatePaise: string | null;
  gstBasisPoints: number | null;
  taxInclusive: boolean;
  coverage: string;
  substitution: string | null;
  subtotalPaise: string;
  gstPaise: string;
  totalPaise: string;
};

type QuoteExport = {
  quoteId: string;
  supplierName: string;
  revision: number;
  submittedAt: string;
  deliveryDate: string;
  validUntil: string;
  subtotalPaise: string;
  gstPaise: string;
  freightPaise: string;
  totalPaise: string;
  coveredItemCount: number;
  totalItemCount: number;
  supplierActive: boolean;
  awardable: boolean;
  awardIssues: string[];
  deliveryFit: 'ON_OR_BEFORE' | 'AFTER_REQUESTED_DATE';
  expired: boolean;
  missingTerms: boolean;
  fullCoverage: boolean;
  commercialTerms: string | null;
  notes: string | null;
  items: QuoteItemExport[];
};

export type AwardExport = {
  id: string;
  requestId: string;
  requestTitle: string;
  rationale: string | null;
  totalPaise: string;
  createdAt: string;
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    gstin?: string | null;
    freightPaise: string;
  }>;
  lines: Array<{
    requestItemId: string;
    itemName: string;
    supplierId: string;
    quantity: string;
    unit: string;
    unitRatePaise: string;
    gstBasisPoints: number;
    subtotalPaise: string;
    gstPaise: string;
    totalPaise: string;
  }>;
};

function rupees(paise: string) {
  const value = BigInt(paise);
  if (value < BigInt(0)) throw new RangeError('Export money cannot be negative.');
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}

function gstPercent(basisPoints: number | null) {
  return basisPoints === null ? '' : formatScaledDecimal(BigInt(basisPoints), 2);
}

function deliveryAddress(details: RequestExport['deliveryDetails']) {
  return [details.addressLine, details.city, details.state, details.pin]
    .filter((value): value is string => Boolean(value))
    .join(', ');
}

export function requestCsv(request: RequestExport) {
  const header: CsvValue[] = [
    'Request ID', 'Request title', 'Status', 'Delivery date', 'Quote deadline',
    'Delivery address', 'Delivery instructions', 'Commercial terms',
    'Item ID', 'Item name', 'Quantity', 'Unit',
  ];
  const rows = request.items.map<CsvValue[]>((item) => [
    request.id,
    request.title,
    request.status,
    request.deliveryDate,
    request.quoteDeadline,
    deliveryAddress(request.deliveryDetails),
    request.deliveryDetails.instructions ?? '',
    request.commercialTerms ?? '',
    item.id,
    item.name,
    item.quantity,
    item.unit,
  ]);
  return serializeCsv([header, ...rows]);
}

export function quoteComparisonCsv(input: {
  request: RequestExport & { itemCount: number };
  quotes: QuoteExport[];
}) {
  const header: CsvValue[] = [
    'Supplier', 'Quote revision', 'Submitted at', 'Quote ID', 'Item ID',
    'Item name', 'Requested quantity', 'Requested unit', 'Available quantity',
    'Quoted unit', 'Unit rate INR', 'GST percent', 'Tax inclusive', 'Coverage',
    'Substitution', 'Line subtotal INR', 'Line GST INR', 'Line total INR',
    'Quote freight INR', 'Quote total INR', 'Supplier active', 'Awardable',
    'Award issues', 'Delivery fit', 'Quote expired', 'Terms present',
    'Full coverage', 'Delivery date', 'Valid until',
    'Covered items', 'Total items', 'Commercial terms', 'Notes',
  ];
  const rows = input.quotes.flatMap<CsvValue[]>((quote) =>
    quote.items.map((item) => [
      quote.supplierName,
      quote.revision,
      quote.submittedAt,
      quote.quoteId,
      item.requestItemId,
      item.requestItemName,
      item.requestedQuantity,
      item.requestUnit,
      item.quotedAvailableQuantity,
      item.quotedUnit,
      item.normalizedUnitRatePaise === null ? '' : rupees(item.normalizedUnitRatePaise),
      gstPercent(item.gstBasisPoints),
      item.taxInclusive ? 'Yes' : 'No',
      item.coverage,
      item.substitution,
      rupees(item.subtotalPaise),
      rupees(item.gstPaise),
      rupees(item.totalPaise),
      rupees(quote.freightPaise),
      rupees(quote.totalPaise),
      quote.supplierActive ? 'Yes' : 'No',
      quote.awardable ? 'Yes' : 'No',
      quote.awardIssues.join('; '),
      quote.deliveryFit === 'ON_OR_BEFORE'
        ? 'On or before requested date'
        : 'After requested date',
      quote.expired ? 'Yes' : 'No',
      quote.missingTerms ? 'No' : 'Yes',
      quote.fullCoverage ? 'Yes' : 'No',
      quote.deliveryDate,
      quote.validUntil,
      quote.coveredItemCount,
      quote.totalItemCount,
      quote.commercialTerms,
      quote.notes,
    ]),
  );
  return serializeCsv([header, ...rows]);
}

export function awardCsv(award: AwardExport) {
  const suppliers = new Map(award.suppliers.map((supplier) => [supplier.supplierId, supplier]));
  const header: CsvValue[] = [
    'Award ID', 'Request ID', 'Request title', 'Awarded at', 'Decision reason',
    'Supplier', 'Supplier GSTIN', 'Item ID', 'Item name', 'Quantity', 'Unit',
    'Unit rate INR', 'GST percent', 'Line subtotal INR', 'Line GST INR',
    'Line total INR', 'Supplier freight INR', 'Award total INR',
  ];
  const rows = award.lines.map<CsvValue[]>((line) => {
    const supplier = suppliers.get(line.supplierId);
    if (!supplier) throw new TypeError('Award line supplier snapshot is missing.');
    return [
      award.id,
      award.requestId,
      award.requestTitle,
      award.createdAt,
      award.rationale,
      supplier.supplierName,
      supplier.gstin ?? '',
      line.requestItemId,
      line.itemName,
      line.quantity,
      line.unit,
      rupees(line.unitRatePaise),
      gstPercent(line.gstBasisPoints),
      rupees(line.subtotalPaise),
      rupees(line.gstPaise),
      rupees(line.totalPaise),
      rupees(supplier.freightPaise),
      rupees(award.totalPaise),
    ];
  });
  return serializeCsv([header, ...rows]);
}

export function accountingCsv(award: AwardExport) {
  const totals = new Map<
    string,
    { subtotalPaise: bigint; gstPaise: bigint; lineTotalPaise: bigint }
  >();
  for (const line of award.lines) {
    const current = totals.get(line.supplierId) ?? {
      subtotalPaise: BigInt(0),
      gstPaise: BigInt(0),
      lineTotalPaise: BigInt(0),
    };
    current.subtotalPaise += BigInt(line.subtotalPaise);
    current.gstPaise += BigInt(line.gstPaise);
    current.lineTotalPaise += BigInt(line.totalPaise);
    totals.set(line.supplierId, current);
  }

  const header: CsvValue[] = [
    'Award ID', 'Request ID', 'Request title', 'Awarded at', 'Supplier ID',
    'Supplier', 'Supplier GSTIN', 'Goods subtotal INR', 'GST INR',
    'Goods total INR', 'Freight INR', 'Payable INR', 'Decision reason',
  ];
  const rows = award.suppliers.map<CsvValue[]>((supplier) => {
    const supplierTotals = totals.get(supplier.supplierId);
    if (!supplierTotals) {
      throw new TypeError('Award supplier has no committed lines.');
    }
    const payable = supplierTotals.lineTotalPaise + BigInt(supplier.freightPaise);
    return [
      award.id,
      award.requestId,
      award.requestTitle,
      award.createdAt,
      supplier.supplierId,
      supplier.supplierName,
      supplier.gstin ?? '',
      rupees(supplierTotals.subtotalPaise.toString()),
      rupees(supplierTotals.gstPaise.toString()),
      rupees(supplierTotals.lineTotalPaise.toString()),
      rupees(supplier.freightPaise),
      rupees(payable.toString()),
      award.rationale,
    ];
  });
  return serializeCsv([header, ...rows]);
}
