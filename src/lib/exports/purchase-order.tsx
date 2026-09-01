import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';

import {
  ExportTooLargeError,
  MAX_EXPORT_BYTES,
} from '@/lib/exports/export-limit';

type Party = {
  name: string;
  gstin: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  phone: string | null;
};

export type PurchaseOrderData = {
  awardId: string;
  requestId: string;
  requestTitle: string;
  awardedAt: string;
  buyer: Party;
  delivery: {
    requestedDeliveryDate: string;
    addressLine: string;
    city: string;
    state: string;
    pin: string;
    instructions: string | null;
    commercialTerms: string | null;
  };
  supplier: {
    supplierId: string;
    supplierName: string;
    gstin: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pin: string | null;
    freightPaise: string;
    minimumOrder: string | null;
    commercialTerms: string | null;
    notes: string | null;
    deliveryDate: string;
    validUntil: string;
  };
  lines: Array<{
    requestItemId: string;
    itemName: string;
    requestedDescription: string | null;
    requestedBrand: string | null;
    suppliedBrand: string | null;
    requestedPackSize: string | null;
    suppliedPackSize: string | null;
    requestedQualityGrade: string | null;
    suppliedQualityGrade: string | null;
    substitution: string | null;
    quantity: string;
    unit: string;
    unitRatePaise: string;
    gstBasisPoints: number;
    taxInclusive: boolean;
    subtotalPaise: string;
    gstPaise: string;
    totalPaise: string;
  }>;
  subtotalPaise: string;
  gstPaise: string;
  freightPaise: string;
  totalPaise: string;
};

function refPart(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (normalized || 'RECORD').slice(0, 10).padEnd(10, '0');
}

export function purchaseOrderNumber(input: Pick<PurchaseOrderData, 'awardId' | 'supplier'>) {
  return `QP-${refPart(input.awardId).slice(0, 9)}-${refPart(input.supplier.supplierId).slice(0, 8)}`;
}

export function purchaseOrderDeliverySummary(
  input: Pick<PurchaseOrderData, 'delivery' | 'supplier'>,
) {
  return {
    requested: `Requested delivery: ${input.delivery.requestedDeliveryDate}`,
    committed: `Supplier committed delivery: ${input.supplier.deliveryDate}`,
  };
}

function rupees(paise: string) {
  const value = BigInt(paise);
  if (value < BigInt(0)) throw new RangeError('Purchase-order money cannot be negative.');
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}

function gstPercent(basisPoints: number) {
  return `${Math.trunc(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}%`;
}

function address(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(', ');
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 38,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    color: '#101817',
  },
  brand: { color: '#a84e25', fontSize: 10, fontFamily: 'Helvetica-Bold' },
  heading: { fontSize: 23, fontFamily: 'Helvetica-Bold', marginTop: 5 },
  muted: { color: '#59625f' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#c9cbc5',
  },
  right: { textAlign: 'right' },
  columns: { flexDirection: 'row', gap: 24, marginTop: 18 },
  column: { flexGrow: 1, flexBasis: 0 },
  label: {
    fontSize: 7,
    color: '#6b706d',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
  },
  partyName: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 3 },
  meta: {
    marginTop: 16,
    padding: 10,
    backgroundColor: '#f3efe7',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  table: { marginTop: 18, borderTopWidth: 1, borderTopColor: '#1b2725' },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#d5d5d0',
    paddingVertical: 7,
  },
  tableHeader: {
    fontFamily: 'Helvetica-Bold',
    backgroundColor: '#f7f4ed',
    paddingVertical: 6,
  },
  item: { width: '40%', paddingRight: 8 },
  itemName: { fontFamily: 'Helvetica-Bold' },
  specification: { color: '#59625f', fontSize: 7, marginTop: 2 },
  qty: { width: '12%', textAlign: 'right' },
  rate: { width: '13%', textAlign: 'right' },
  gst: { width: '10%', textAlign: 'right' },
  amount: { width: '12%', textAlign: 'right' },
  total: { width: '13%', textAlign: 'right' },
  totals: { marginTop: 12, marginLeft: '55%' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grandTotal: {
    borderTopWidth: 1,
    borderTopColor: '#1b2725',
    marginTop: 3,
    paddingTop: 6,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
  },
  notes: { marginTop: 20, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#c9cbc5' },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#777c78',
    fontSize: 7,
  },
});

function PurchaseOrderDocument({ data }: { data: PurchaseOrderData }) {
  const issuedAt = new Date(data.awardedAt);
  if (Number.isNaN(issuedAt.getTime())) throw new TypeError('Invalid award timestamp.');
  const poNumber = purchaseOrderNumber(data);
  const deliveryDates = purchaseOrderDeliverySummary(data);
  return (
    <Document
      title={`Purchase order ${poNumber}`}
      author="QuotePlate"
      subject={data.requestTitle}
      creator="QuotePlate"
      producer="QuotePlate"
      creationDate={issuedAt}
      modificationDate={issuedAt}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>QUOTEPLATE</Text>
            <Text style={styles.heading}>Purchase order</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.label}>PO reference</Text>
            <Text>{poNumber}</Text>
            <Text style={[styles.muted, { marginTop: 4 }]}>Awarded {data.awardedAt.slice(0, 10)}</Text>
          </View>
        </View>

        <View style={styles.columns}>
          <View style={styles.column}>
            <Text style={styles.label}>Buyer</Text>
            <Text style={styles.partyName}>{data.buyer.name}</Text>
            <Text>{address([data.buyer.addressLine, data.buyer.city, data.buyer.state, data.buyer.pin])}</Text>
            {data.buyer.gstin ? <Text>GSTIN: {data.buyer.gstin}</Text> : null}
            {data.buyer.phone ? <Text>Phone: {data.buyer.phone}</Text> : null}
          </View>
          <View style={styles.column}>
            <Text style={styles.label}>Supplier</Text>
            <Text style={styles.partyName}>{data.supplier.supplierName}</Text>
            <Text>{address([data.supplier.addressLine, data.supplier.city, data.supplier.state, data.supplier.pin])}</Text>
            {data.supplier.gstin ? <Text>GSTIN: {data.supplier.gstin}</Text> : null}
            {data.supplier.contactName ? <Text>Contact: {data.supplier.contactName}</Text> : null}
            {data.supplier.phone ? <Text>Phone: {data.supplier.phone}</Text> : null}
            {data.supplier.email ? <Text>Email: {data.supplier.email}</Text> : null}
          </View>
        </View>

        <View style={styles.meta}>
          <View>
            <Text style={styles.label}>Request</Text>
            <Text>{data.requestTitle}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.label}>Delivery dates</Text>
            <Text>{deliveryDates.requested}</Text>
            <Text>{deliveryDates.committed}</Text>
            <Text>{address([data.delivery.addressLine, data.delivery.city, data.delivery.state, data.delivery.pin])}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]} fixed>
            <Text style={styles.item}>Item</Text>
            <Text style={styles.qty}>Quantity</Text>
            <Text style={styles.rate}>Rate INR</Text>
            <Text style={styles.gst}>GST</Text>
            <Text style={styles.amount}>Net INR</Text>
            <Text style={styles.total}>Gross INR</Text>
          </View>
          {data.lines.map((line) => {
            const requested = [
              line.requestedDescription,
              line.requestedBrand ? `brand ${line.requestedBrand}` : null,
              line.requestedPackSize ? `pack ${line.requestedPackSize}` : null,
              line.requestedQualityGrade
                ? `grade ${line.requestedQualityGrade}`
                : null,
            ].filter((value): value is string => value !== null).join(' · ');
            const supplied = [
              line.suppliedBrand ? `brand ${line.suppliedBrand}` : null,
              line.suppliedPackSize ? `pack ${line.suppliedPackSize}` : null,
              line.suppliedQualityGrade
                ? `grade ${line.suppliedQualityGrade}`
                : null,
              line.substitution ? `substitution ${line.substitution}` : null,
            ].filter((value): value is string => value !== null).join(' · ');
            return (
              <View style={styles.tableRow} key={`${line.requestItemId}-${line.quantity}`} wrap={false}>
                <View style={styles.item}>
                  <Text style={styles.itemName}>{line.itemName}</Text>
                  <Text style={styles.specification}>
                    Requested: {requested || 'No additional specification'}
                  </Text>
                  <Text style={styles.specification}>
                    Supplied: {supplied || 'As requested'}
                  </Text>
                </View>
                <Text style={styles.qty}>{line.quantity} {line.unit}</Text>
                <Text style={styles.rate}>{rupees(line.unitRatePaise)}</Text>
                <Text style={styles.gst}>
                  {gstPercent(line.gstBasisPoints)} {line.taxInclusive ? 'incl.' : 'excl.'}
                </Text>
                <Text style={styles.amount}>{rupees(line.subtotalPaise)}</Text>
                <Text style={styles.total}>{rupees(line.totalPaise)}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}><Text>Goods subtotal</Text><Text>INR {rupees(data.subtotalPaise)}</Text></View>
          <View style={styles.totalRow}><Text>GST</Text><Text>INR {rupees(data.gstPaise)}</Text></View>
          <View style={styles.totalRow}><Text>Freight</Text><Text>INR {rupees(data.freightPaise)}</Text></View>
          <View style={[styles.totalRow, styles.grandTotal]}><Text>Total</Text><Text>INR {rupees(data.totalPaise)}</Text></View>
        </View>

        <View style={styles.notes} wrap={false}>
          <Text style={styles.label}>Terms and delivery notes</Text>
          <Text>Buyer terms: {data.delivery.commercialTerms ?? 'None recorded.'}</Text>
          <Text style={{ marginTop: 4 }}>
            Supplier terms: {data.supplier.commercialTerms ?? 'None recorded.'}
          </Text>
          <Text style={{ marginTop: 4 }}>
            Minimum order: {data.supplier.minimumOrder ?? 'None recorded.'}
          </Text>
          <Text style={{ marginTop: 4 }}>Quote valid until: {data.supplier.validUntil}</Text>
          {data.supplier.notes ? <Text style={{ marginTop: 4 }}>Supplier notes: {data.supplier.notes}</Text> : null}
          {data.delivery.instructions ? <Text style={{ marginTop: 4 }}>Delivery: {data.delivery.instructions}</Text> : null}
        </View>

        <View style={styles.footer} fixed>
          <Text>Generated from the committed QuotePlate award record.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdf(data: PurchaseOrderData) {
  if (data.lines.length < 1 || data.lines.length > 2_000) {
    throw new TypeError('Purchase order requires between 1 and 2,000 lines.');
  }
  const buffer = await renderToBuffer(<PurchaseOrderDocument data={data} />);
  if (buffer.byteLength > MAX_EXPORT_BYTES) {
    throw new ExportTooLargeError();
  }
  return new Uint8Array(buffer);
}
