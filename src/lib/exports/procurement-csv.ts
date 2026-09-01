import type { ItemSpecificationV1 } from '@/lib/domain/item-specification';
import type { ProcurementUnit } from '@/lib/domain/quantity';
import { formatScaledDecimal } from '@/lib/domain/validation';
import { serializeCsv, type CsvValue } from '@/lib/exports/csv';

export type RequestExport = {
  id: string;
  title: string;
  status: string;
  deliveryDate: string;
  quoteDeadline: string;
  deliveryDetails: {
    addressLine: string;
    city: string;
    state: string;
    pin: string;
    instructions: string | null;
  };
  commercialTerms: string | null;
  items: Array<{
    id: string;
    itemKey: string;
    name: string;
    quantity: string;
    unit: ProcurementUnit;
    specification: ItemSpecificationV1;
  }>;
};

type QuoteItemExport = {
  requestItemId: string;
  requestItemKey: string;
  requestItemName: string;
  requestedQuantity: string;
  requestUnit: ProcurementUnit;
  requestedSpecification: ItemSpecificationV1;
  suppliedSpecification: {
    brand: string | null;
    packSize: string | null;
    qualityGrade: string | null;
  };
  quotedAvailableQuantity: string | null;
  quotedUnit: ProcurementUnit | null;
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
  supplierRequestId: string;
  supplierName: string;
  supplierActive: boolean;
  revision: number;
  submittedAt: string;
  deliveryDate: string;
  validUntil: string;
  minimumOrder: string | null;
  subtotalPaise: string;
  gstPaise: string;
  freightPaise: string;
  totalPaise: string;
  coveredItemCount: number;
  totalItemCount: number;
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
    gstin: string | null;
    freightPaise: string;
  }>;
  lines: Array<{
    requestItemId: string;
    itemKey: string;
    itemName: string;
    requestedQuantity: string;
    requestedUnit: ProcurementUnit;
    requestedSpecification: ItemSpecificationV1;
    supplierId: string;
    quantity: string;
    unit: ProcurementUnit;
    unitRatePaise: string;
    gstBasisPoints: number;
    taxInclusive: boolean;
    suppliedBrand: string | null;
    suppliedPackSize: string | null;
    suppliedQualityGrade: string | null;
    substitution: string | null;
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
  return [details.addressLine, details.city, details.state, details.pin].join(', ');
}

function requestedSpecificationCells(specification: ItemSpecificationV1): CsvValue[] {
  return [
    specification.description,
    specification.preferredBrand,
    specification.packSize,
    specification.qualityGrade,
    specification.notes,
    specification.referenceUrl,
  ];
}

export function requestCsv(request: RequestExport) {
  const header: CsvValue[] = [
    'Request ID', 'Request title', 'Status', 'Delivery date', 'Quote deadline',
    'Delivery address', 'Delivery instructions', 'Commercial terms',
    'Item ID', 'Item key', 'Item name', 'Quantity', 'Unit', 'Category',
    'Requested description', 'Requested brand', 'Requested pack size',
    'Requested quality grade', 'Requested notes', 'Reference URL',
  ];
  const rows = request.items.map<CsvValue[]>((item) => [
    request.id,
    request.title,
    request.status,
    request.deliveryDate,
    request.quoteDeadline,
    deliveryAddress(request.deliveryDetails),
    request.deliveryDetails.instructions,
    request.commercialTerms,
    item.id,
    item.itemKey,
    item.name,
    item.quantity,
    item.unit,
    item.specification.category,
    ...requestedSpecificationCells(item.specification),
  ]);
  return serializeCsv([header, ...rows]);
}

export function quoteComparisonCsv(input: {
  request: RequestExport & { itemCount: number };
  quotes: QuoteExport[];
}) {
  const header: CsvValue[] = [
    'Supplier', 'Supplier request ID', 'Quote revision', 'Submitted at',
    'Item ID', 'Item key', 'Item name', 'Requested quantity', 'Requested unit',
    'Requested description', 'Requested brand', 'Supplied brand',
    'Requested pack size', 'Supplied pack size', 'Requested quality grade',
    'Supplied quality grade', 'Available quantity', 'Quoted unit',
    'Unit rate INR', 'GST percent', 'Tax inclusive', 'Coverage', 'Substitution',
    'Line subtotal INR', 'Line GST INR', 'Line total INR', 'Quote freight INR',
    'Quote total INR', 'Supplier active', 'Delivery fit', 'Quote expired',
    'Terms present', 'Full coverage', 'Delivery date', 'Valid until',
    'Covered items', 'Total items', 'Minimum order', 'Commercial terms', 'Notes',
  ];
  const rows = input.quotes.flatMap<CsvValue[]>((quote) =>
    quote.items.map((item) => [
      quote.supplierName,
      quote.supplierRequestId,
      quote.revision,
      quote.submittedAt,
      item.requestItemId,
      item.requestItemKey,
      item.requestItemName,
      item.requestedQuantity,
      item.requestUnit,
      item.requestedSpecification.description,
      item.requestedSpecification.preferredBrand,
      item.suppliedSpecification.brand,
      item.requestedSpecification.packSize,
      item.suppliedSpecification.packSize,
      item.requestedSpecification.qualityGrade,
      item.suppliedSpecification.qualityGrade,
      item.quotedAvailableQuantity,
      item.quotedUnit,
      item.normalizedUnitRatePaise === null
        ? ''
        : rupees(item.normalizedUnitRatePaise),
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
      quote.minimumOrder,
      quote.commercialTerms,
      quote.notes,
    ]),
  );
  return serializeCsv([header, ...rows]);
}

export function awardCsv(award: AwardExport) {
  const suppliers = new Map(
    award.suppliers.map((supplier) => [supplier.supplierId, supplier]),
  );
  const header: CsvValue[] = [
    'Award ID', 'Request ID', 'Request title', 'Awarded at', 'Decision reason',
    'Supplier', 'Supplier GSTIN', 'Item ID', 'Item key', 'Item name',
    'Requested quantity', 'Requested unit', 'Awarded quantity', 'Awarded unit',
    'Requested description', 'Requested brand', 'Supplied brand',
    'Requested pack size', 'Supplied pack size', 'Requested quality grade',
    'Supplied quality grade', 'Substitution', 'Unit rate INR', 'GST percent',
    'Tax inclusive', 'Line subtotal INR', 'Line GST INR', 'Line total INR',
    'Supplier freight INR', 'Award total INR',
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
      supplier.gstin,
      line.requestItemId,
      line.itemKey,
      line.itemName,
      line.requestedQuantity,
      line.requestedUnit,
      line.quantity,
      line.unit,
      line.requestedSpecification.description,
      line.requestedSpecification.preferredBrand,
      line.suppliedBrand,
      line.requestedSpecification.packSize,
      line.suppliedPackSize,
      line.requestedSpecification.qualityGrade,
      line.suppliedQualityGrade,
      line.substitution,
      rupees(line.unitRatePaise),
      gstPercent(line.gstBasisPoints),
      line.taxInclusive ? 'Yes' : 'No',
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
    if (!supplierTotals) throw new TypeError('Award supplier has no committed lines.');
    const payable = supplierTotals.lineTotalPaise + BigInt(supplier.freightPaise);
    return [
      award.id,
      award.requestId,
      award.requestTitle,
      award.createdAt,
      supplier.supplierId,
      supplier.supplierName,
      supplier.gstin,
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
