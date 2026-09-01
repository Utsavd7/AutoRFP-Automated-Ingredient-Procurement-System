import {
  AwardDocumentStorageCorruptionError,
  validateAwardDocuments,
} from '@/lib/awards/award-document';

const requestedSpecification = {
  v: 1,
  category: 'VEGETABLES',
  description: 'Firm red tomatoes',
  preferredBrand: 'Farm Select',
  packSize: '5 kg crate',
  qualityGrade: 'A',
  notes: null,
  referenceUrl: null,
  thumbnailWebpBase64: null,
} as const;

function allocationLine(requestItemId: string) {
  return {
    requestItemId,
    supplierRequestId: 'supplier-request-a',
    supplierId: 'supplier-a',
    quoteRevision: 2,
    quantity: '2.5',
    unit: 'KILOGRAM',
    unitRatePaise: '11800',
    gstBasisPoints: 1800,
    subtotalPaise: '25000',
    gstPaise: '4500',
    totalPaise: '29500',
  };
}

function descriptiveLine(requestItemId: string, itemName: string) {
  return {
    requestItemId,
    itemKey: requestItemId,
    itemName,
    requestedQuantity: '2.5',
    requestedUnit: 'KILOGRAM',
    requestedSpecification,
    taxInclusive: true,
    suppliedBrand: 'Harvest House',
    suppliedPackSize: '5 kg crate',
    suppliedQualityGrade: 'Premium',
    substitution: 'Vine-ripened equivalent',
  };
}

function validDocuments() {
  return {
    allocationLines: {
      v: 1,
      lines: [allocationLine('tomato'), allocationLine('cherry-tomato')],
    },
    supplierSnapshots: {
      v: 1,
      suppliers: [
        {
          supplierId: 'supplier-a',
          supplierRequestId: 'supplier-request-a',
          quoteRevision: 2,
          supplierName: 'A Produce',
          contactName: 'Asha Rao',
          phone: '9000000001',
          whatsappNumber: null,
          email: 'orders@aproduce.example',
          addressLine: '1 Market Road',
          city: 'Pune',
          state: 'Maharashtra',
          pin: '411001',
          gstin: '27ABCDE1234F1Z5',
          submittedAt: '2026-08-30T10:00:00.123Z',
          deliveryDate: '2026-09-02',
          validUntil: '2026-09-01',
          minimumOrder: 'Minimum invoice INR 2,500',
          freightPaise: '50',
          commercialTerms: 'Payment within 15 days',
          notes: null,
          subtotalPaise: '50000',
          gstPaise: '9000',
          totalPaise: '59050',
          lines: [
            descriptiveLine('tomato', 'Tomato'),
            descriptiveLine('cherry-tomato', 'Cherry tomato'),
          ],
        },
      ],
    },
    deliverySnapshot: {
      v: 1,
      requestTitle: 'Weekly produce',
      requestedDeliveryDate: '2026-09-02',
      deliveryDetails: {
        addressLine: '18 Koregaon Park Road',
        city: 'Pune',
        state: 'Maharashtra',
        pin: '411001',
        instructions: 'Use the service entrance',
      },
      commercialTerms: 'Rates must include packing.',
      buyer: {
        name: 'Monsoon Table Pune',
        addressLine: '18 Koregaon Park Road',
        city: 'Pune',
        state: 'Maharashtra',
        pin: '411001',
        phone: '9000000000',
        gstin: null,
      },
    },
    totalPaise: BigInt(59_050),
  };
}

function databaseJson<T>(value: T): T {
  return structuredClone(value);
}

describe('compact award documents', () => {
  it('jointly validates exact GST-inclusive allocations, request coverage, snapshots, and freight once', () => {
    const documents = validDocuments();

    expect(validateAwardDocuments(documents)).toEqual({
      allocationLines: documents.allocationLines,
      supplierSnapshots: documents.supplierSnapshots,
      deliverySnapshot: documents.deliverySnapshot,
      totalPaise: '59050',
      splitAward: false,
    });
  });

  it.each([
    ['unknown key', (documents: ReturnType<typeof validDocuments>) => {
      Object.assign(documents.allocationLines.lines[0]!, { supplierName: 'client fact' });
    }],
    ['duplicate allocation identity', (documents: ReturnType<typeof validDocuments>) => {
      documents.allocationLines.lines[1] = { ...documents.allocationLines.lines[0]! };
      documents.supplierSnapshots.suppliers[0]!.lines[1] = {
        ...documents.supplierSnapshots.suppliers[0]!.lines[0]!,
      };
    }],
    ['missing descriptive snapshot', (documents: ReturnType<typeof validDocuments>) => {
      documents.supplierSnapshots.suppliers[0]!.lines.pop();
    }],
    ['unused supplier snapshot', (documents: ReturnType<typeof validDocuments>) => {
      documents.supplierSnapshots.suppliers.push({
        ...documents.supplierSnapshots.suppliers[0]!,
        supplierId: 'supplier-unused',
        supplierRequestId: 'supplier-request-unused',
        lines: [],
      });
    }],
    ['inexact request coverage', (documents: ReturnType<typeof validDocuments>) => {
      documents.allocationLines.lines[0]!.quantity = '2';
      documents.allocationLines.lines[0]!.subtotalPaise = '20000';
      documents.allocationLines.lines[0]!.gstPaise = '3600';
      documents.allocationLines.lines[0]!.totalPaise = '23600';
      documents.totalPaise = BigInt(53_150);
    }],
    ['incorrect line money', (documents: ReturnType<typeof validDocuments>) => {
      documents.allocationLines.lines[0]!.gstPaise = '4499';
    }],
    ['incorrect scalar total', (documents: ReturnType<typeof validDocuments>) => {
      documents.totalPaise = BigInt(59_049);
    }],
  ])('fails closed for %s', (_label, corrupt) => {
    const documents = databaseJson(validDocuments()) as ReturnType<typeof validDocuments>;
    documents.totalPaise = validDocuments().totalPaise;
    corrupt(documents);

    expect(() => validateAwardDocuments(documents)).toThrow(
      AwardDocumentStorageCorruptionError,
    );
  });

  it('rejects prototypes, accessors, and an over-limit delivery document', () => {
    const inherited = validDocuments();
    Object.setPrototypeOf(inherited.deliverySnapshot, { polluted: true });

    const accessor = validDocuments();
    Object.defineProperty(accessor.supplierSnapshots.suppliers[0], 'notes', {
      enumerable: true,
      get: () => 'secret',
    });

    const oversized = validDocuments();
    oversized.deliverySnapshot.deliveryDetails.instructions = '₹'.repeat(6_000);

    for (const documents of [inherited, accessor, oversized]) {
      expect(() => validateAwardDocuments(documents)).toThrow(
        AwardDocumentStorageCorruptionError,
      );
    }
  });
});
