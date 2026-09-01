import type { ProcurementUnit } from '@/lib/domain/quantity';

export const emptyCapabilities = { v: 1, categories: [], items: [] } as const;

export function requestItems(input: {
  id?: string;
  itemKey?: string;
  name?: string;
  quantity?: string;
  unit?: ProcurementUnit;
} = {}) {
  return {
    v: 1,
    items: [{
      id: input.id ?? 'item-1',
      itemKey: input.itemKey ?? 'item-1',
      name: input.name ?? 'Produce',
      quantity: input.quantity ?? '1',
      unit: input.unit ?? 'KILOGRAM',
      specification: { v: 1, category: 'VEGETABLES' },
      sourcingOverride: null,
    }],
  } as const;
}

export function requestSourcing(supplierId: string) {
  return {
    v: 1,
    default: {
      v: 1,
      modes: ['CURRENT'],
      currentSupplierIds: [supplierId],
      selectedNewSupplierIds: [],
      acceptVerifiedApplications: false,
    },
  } as const;
}

export function quoteRevisions(input: {
  requestItemId?: string;
  quantity?: string;
  count?: number;
  submittedAt?: string;
}) {
  const count = input.count ?? 1;
  const start = new Date(input.submittedAt ?? '2026-08-28T09:00:00.000Z');
  return {
    v: 1,
    revisions: Array.from({ length: count }, (_, index) => ({
      revision: index + 1,
      submittedAt: new Date(start.getTime() + index * 3_600_000).toISOString(),
      deliveryDate: '2026-09-05',
      validUntil: '2026-09-04',
      minimumOrder: null,
      freightPaise: '500',
      commercialTerms: null,
      notes: null,
      items: [{
        requestItemId: input.requestItemId ?? 'item-1',
        noQuote: false,
        availableQuantity: input.quantity ?? '1',
        unit: 'KILOGRAM',
        unitRatePaise: '80000',
        gstBasisPoints: 0,
        taxInclusive: false,
        suppliedBrand: null,
        suppliedPackSize: null,
        suppliedQualityGrade: null,
        substitution: null,
        subtotalPaise: '80000',
        gstPaise: '0',
        totalPaise: '80000',
      }],
      subtotalPaise: '80000',
      gstPaise: '0',
      totalPaise: '80500',
    })),
  };
}

export function awardDocuments(input: {
  supplierId: string;
  supplierRequestId: string;
  supplierName: string;
  itemKey?: string;
  itemName?: string;
  totalPaise: string;
  requestTitle: string;
}) {
  return {
    allocationLines: {
      v: 1,
      lines: [{
        requestItemId: 'item-1',
        supplierRequestId: input.supplierRequestId,
        supplierId: input.supplierId,
        quoteRevision: 1,
        quantity: '1',
        unit: 'KILOGRAM',
        unitRatePaise: input.totalPaise,
        gstBasisPoints: 0,
        subtotalPaise: input.totalPaise,
        gstPaise: '0',
        totalPaise: input.totalPaise,
      }],
    },
    supplierSnapshots: {
      v: 1,
      suppliers: [{
        supplierId: input.supplierId,
        supplierRequestId: input.supplierRequestId,
        quoteRevision: 1,
        supplierName: input.supplierName,
        contactName: null,
        phone: null,
        whatsappNumber: null,
        email: null,
        addressLine: null,
        city: null,
        state: null,
        pin: null,
        gstin: null,
        submittedAt: '2026-08-28T09:00:00.000Z',
        deliveryDate: '2026-09-05',
        validUntil: '2026-09-04',
        minimumOrder: null,
        freightPaise: '0',
        commercialTerms: null,
        notes: null,
        subtotalPaise: input.totalPaise,
        gstPaise: '0',
        totalPaise: input.totalPaise,
        lines: [{
          requestItemId: 'item-1',
          itemKey: input.itemKey ?? 'item-1',
          itemName: input.itemName ?? 'Produce',
          requestedQuantity: '1',
          requestedUnit: 'KILOGRAM',
          requestedSpecification: { v: 1, category: 'VEGETABLES' },
          taxInclusive: false,
          suppliedBrand: null,
          suppliedPackSize: null,
          suppliedQualityGrade: null,
          substitution: null,
        }],
      }],
    },
    deliverySnapshot: {
      v: 1,
      requestTitle: input.requestTitle,
      requestedDeliveryDate: '2026-09-05',
      deliveryDetails: {
        addressLine: '1 Market Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400001',
        instructions: null,
      },
      commercialTerms: null,
      buyer: {
        name: 'Test Kitchen',
        addressLine: '1 Market Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400001',
        phone: '9000000000',
        gstin: null,
      },
    },
  };
}
