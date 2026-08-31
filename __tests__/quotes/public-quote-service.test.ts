import type {
  RequestItemsV1,
  RequestSourcingV1,
} from '@/lib/procurement/request-document';
import { eligibleQuoteRequestItems } from '@/lib/quotes/public-quote-service';

const specification = {
  v: 1 as const,
  category: 'VEGETABLES' as const,
  description: null,
  preferredBrand: null,
  packSize: null,
  qualityGrade: null,
  notes: null,
  referenceUrl: null,
  thumbnailWebpBase64: null,
};

function selection(
  overrides: Partial<RequestSourcingV1['default']> = {},
): RequestSourcingV1['default'] {
  return {
    v: 1 as const,
    modes: ['CURRENT', 'SELECTED_NEW', 'VERIFIED_NEW'],
    currentSupplierIds: ['current-a'],
    selectedNewSupplierIds: ['selected-a'],
    acceptVerifiedApplications: true,
    ...overrides,
  };
}

const items: RequestItemsV1 = {
  v: 1,
  items: [
    {
      id: 'default-item',
      itemKey: 'default-item',
      name: 'Default item',
      quantity: '1',
      unit: 'KILOGRAM',
      specification,
      sourcingOverride: null,
    },
    {
      id: 'current-only',
      itemKey: 'current-only',
      name: 'Current only',
      quantity: '2',
      unit: 'PACK',
      specification,
      sourcingOverride: selection({
        modes: ['CURRENT'],
        currentSupplierIds: ['current-a'],
        selectedNewSupplierIds: [],
        acceptVerifiedApplications: false,
      }),
    },
    {
      id: 'selected-only',
      itemKey: 'selected-only',
      name: 'Selected only',
      quantity: '3',
      unit: 'CASE',
      specification,
      sourcingOverride: selection({
        modes: ['SELECTED_NEW'],
        currentSupplierIds: [],
        selectedNewSupplierIds: ['selected-a'],
        acceptVerifiedApplications: false,
      }),
    },
    {
      id: 'application-only',
      itemKey: 'application-only',
      name: 'Application only',
      quantity: '4',
      unit: 'CRATE',
      specification,
      sourcingOverride: selection({
        modes: ['VERIFIED_NEW'],
        currentSupplierIds: [],
        selectedNewSupplierIds: [],
        acceptVerifiedApplications: true,
      }),
    },
  ],
};
const sourcing: RequestSourcingV1 = { v: 1, default: selection() };

describe('public quote eligible-item grant', () => {
  it.each([
    [
      'current supplier',
      { id: 'current-a', applicationRequestId: null },
      ['default-item', 'current-only'],
    ],
    [
      'selected-new supplier',
      { id: 'selected-a', applicationRequestId: null },
      ['default-item', 'selected-only'],
    ],
    [
      'verified applicant for this request',
      { id: 'application-a', applicationRequestId: 'request-a' },
      ['default-item', 'application-only'],
    ],
    [
      'applicant from another request',
      { id: 'application-a', applicationRequestId: 'request-b' },
      [],
    ],
  ])('derives the exact request-order subset for a %s', (_label, supplier, ids) => {
    const eligible = eligibleQuoteRequestItems({
      requestId: 'request-a',
      items,
      sourcing,
      supplier,
    });

    expect(eligible.map(({ id }) => id)).toEqual(ids);
    expect(eligible.every((item) => !('sourcingOverride' in item))).toBe(true);
    expect(JSON.stringify(eligible)).not.toContain('currentSupplierIds');
    expect(JSON.stringify(eligible)).not.toContain('selectedNewSupplierIds');
  });

  it('requires the matching sourcing mode and verified-application opt-in', () => {
    const mismatched: RequestItemsV1 = {
      v: 1,
      items: [
        {
          ...items.items[0]!,
          sourcingOverride: selection({
            modes: ['VERIFIED_NEW'],
            currentSupplierIds: ['current-a'],
            selectedNewSupplierIds: [],
            acceptVerifiedApplications: false,
          }),
        },
      ],
    };

    expect(eligibleQuoteRequestItems({
      requestId: 'request-a',
      items: mismatched,
      sourcing,
      supplier: { id: 'current-a', applicationRequestId: null },
    })).toEqual([]);
    expect(eligibleQuoteRequestItems({
      requestId: 'request-a',
      items: mismatched,
      sourcing,
      supplier: { id: 'application-a', applicationRequestId: 'request-a' },
    })).toEqual([]);
  });
});
