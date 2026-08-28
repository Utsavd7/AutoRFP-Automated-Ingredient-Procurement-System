import {
  decodeRequestCursor,
  encodeRequestCursor,
  ProcurementRequestValidationError,
  validateDraftPatchInput,
  validateLinkActionInput,
  validateOpenRequestInput,
  validateProcurementRequestDraftInput,
} from '@/lib/procurement/request-service';

const now = new Date('2027-01-08T09:00:00.000Z');

const validDraft = {
  title: ' Weekly vegetables — Indiranagar ',
  menuId: 'menu-a',
  ingredientSelection: {
    mode: 'SELECTED',
    ingredientIds: ['ingredient-a', 'ingredient-b'],
  },
  supplierIds: ['supplier-a', 'supplier-b'],
  deliveryDetails: {
    addressLine: '12, 100 Feet Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pin: '560038',
    instructions: ' Deliver before 8:00 AM. ',
  },
  deliveryDate: '2027-01-10',
  quoteDeadline: '2027-01-09T10:00:00.000Z',
  commercialTerms: ' Payment in 15 days. ',
};

describe('procurement request input boundaries', () => {
  it('normalizes a selected-ingredient India request without losing exact IDs', () => {
    expect(validateProcurementRequestDraftInput(validDraft, now)).toEqual({
      title: 'Weekly vegetables — Indiranagar',
      menuId: 'menu-a',
      ingredientSelection: {
        mode: 'SELECTED',
        ingredientIds: ['ingredient-a', 'ingredient-b'],
      },
      supplierIds: ['supplier-a', 'supplier-b'],
      deliveryDetails: {
        addressLine: '12, 100 Feet Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pin: '560038',
        instructions: 'Deliver before 8:00 AM.',
      },
      deliveryDate: new Date('2027-01-10T00:00:00.000Z'),
      quoteDeadline: new Date('2027-01-09T10:00:00.000Z'),
      commercialTerms: 'Payment in 15 days.',
    });
  });

  it('defines full-menu selection explicitly and never accepts a hidden empty selection', () => {
    expect(
      validateProcurementRequestDraftInput(
        {
          ...validDraft,
          ingredientSelection: { mode: 'ALL' },
        },
        now,
      ).ingredientSelection,
    ).toEqual({ mode: 'ALL' });

    expect(() =>
      validateProcurementRequestDraftInput(
        {
          ...validDraft,
          ingredientSelection: { mode: 'SELECTED', ingredientIds: [] },
        },
        now,
      ),
    ).toThrow(ProcurementRequestValidationError);
  });

  it.each([
    ['duplicate suppliers', { supplierIds: ['supplier-a', 'supplier-a'] }],
    [
      'duplicate ingredients',
      {
        ingredientSelection: {
          mode: 'SELECTED',
          ingredientIds: ['ingredient-a', 'ingredient-a'],
        },
      },
    ],
    ['past deadline', { quoteDeadline: '2027-01-08T08:59:59.000Z' }],
    ['deadline at delivery', { quoteDeadline: '2027-01-09T18:30:00.000Z' }],
    ['invalid India date', { deliveryDate: '2027-02-30' }],
    ['invalid India PIN', { deliveryDetails: { ...validDraft.deliveryDetails, pin: '56003' } }],
    ['unknown delivery data', { deliveryDetails: { ...validDraft.deliveryDetails, latitude: 13 } }],
    ['unbounded title', { title: 'a'.repeat(161) }],
    ['client authority fields', { tenantId: 'tenant-b', status: 'OPEN' }],
  ])('rejects %s', (_label, change) => {
    expect(() =>
      validateProcurementRequestDraftInput({ ...validDraft, ...change }, now),
    ).toThrow(ProcurementRequestValidationError);
  });

  it('allows only mutable draft metadata and an explicit active supplier set in PATCH', () => {
    expect(
      validateDraftPatchInput(
        {
          title: 'Updated vegetables',
          supplierIds: ['supplier-b'],
          deliveryDetails: validDraft.deliveryDetails,
          deliveryDate: validDraft.deliveryDate,
          quoteDeadline: validDraft.quoteDeadline,
          commercialTerms: null,
        },
        now,
      ),
    ).toMatchObject({
      title: 'Updated vegetables',
      supplierIds: ['supplier-b'],
      commercialTerms: null,
    });

    expect(() =>
      validateDraftPatchInput({ menuId: 'menu-b' }, now),
    ).toThrow(ProcurementRequestValidationError);
    expect(() => validateDraftPatchInput({}, now)).toThrow(
      ProcurementRequestValidationError,
    );
  });

  it('validates versioned rotate and revoke actions with bounded IDs', () => {
    expect(
      validateLinkActionInput({
        action: 'rotate',
        supplierRequestId: 'grant-a',
        expectedVersion: 2,
      }),
    ).toEqual({
      action: 'rotate',
      supplierRequestId: 'grant-a',
      expectedVersion: 2,
    });
    expect(() =>
      validateLinkActionInput({
        action: 'delete',
        supplierRequestId: 'grant-a',
        expectedVersion: 2,
      }),
    ).toThrow(ProcurementRequestValidationError);
  });

  it('accepts only a closed versioned open body', () => {
    expect(validateOpenRequestInput({ expectedVersion: 2 })).toEqual({
      expectedVersion: 2,
    });
    expect(() =>
      validateOpenRequestInput({ expectedVersion: 2, status: 'OPEN' }),
    ).toThrow(ProcurementRequestValidationError);
  });

  it('round-trips an opaque bounded list cursor and rejects tampering', () => {
    const cursor = encodeRequestCursor({
      createdAt: new Date('2027-01-08T10:00:00.000Z'),
      id: 'request-a',
    });
    expect(cursor).not.toContain('request-a');
    expect(decodeRequestCursor(cursor)).toEqual({
      createdAt: new Date('2027-01-08T10:00:00.000Z'),
      id: 'request-a',
    });
    expect(() => decodeRequestCursor(`${cursor}x`)).toThrow(
      ProcurementRequestValidationError,
    );
  });
});
