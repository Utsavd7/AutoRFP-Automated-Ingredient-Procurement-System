import {
  normalizeSupplierPhone,
  SUPPLIER_LIMITS,
  SupplierValidationError,
  validateSupplierLifecycleState,
  validateSupplierCreateInput,
  validateSupplierListInput,
  validateSupplierUpdateInput,
} from '@/lib/suppliers/supplier-schema';

describe('supplier input validation', () => {
  it('normalizes a representative Indian direct supplier', () => {
    expect(
      validateSupplierCreateInput({
        businessName: '  Shree Balaji Fresh Produce  ',
        contactName: '  Mehul Shah  ',
        phone: '98765 43210',
        whatsappNumber: '0091-99887-76655',
        email: '  SALES@BALAJIFRESH.IN  ',
        addressLine: '  41 APMC Market, Vashi  ',
        city: '  Navi Mumbai  ',
        state: '  Maharashtra  ',
        pin: ' 400705 ',
        gstin: ' 27AAPFU0939F1ZV ',
        notes: '  Delivers before 7 am  ',
        isActive: true,
        relationshipType: 'SELECTED_NEW',
        capabilities: {
          v: 1,
          categories: [{ category: 'VEGETABLES', tier: 'CAPABLE', rank: 1 }],
          items: [],
        },
      }),
    ).toEqual({
      businessName: 'Shree Balaji Fresh Produce',
      contactName: 'Mehul Shah',
      phone: '+919876543210',
      whatsappNumber: '+919988776655',
      email: 'sales@balajifresh.in',
      addressLine: '41 APMC Market, Vashi',
      city: 'Navi Mumbai',
      state: 'Maharashtra',
      pin: '400705',
      gstin: '27AAPFU0939F1ZV',
      notes: 'Delivers before 7 am',
      isActive: true,
      relationshipType: 'SELECTED_NEW',
      capabilities: {
        v: 1,
        categories: [{ category: 'VEGETABLES', tier: 'CAPABLE', rank: 1 }],
        items: [],
      },
    });
  });

  it.each([
    ['a local Indian mobile number', '9876543210', '+919876543210'],
    ['an Indian country code', '91 98765 43210', '+919876543210'],
    ['an explicit Indian E.164 number', '+91 98765 43210', '+919876543210'],
    ['an international E.164 number', '+442071838750', '+442071838750'],
  ])('normalizes %s', (_label, input, expected) => {
    expect(normalizeSupplierPhone(input)).toBe(expected);
  });

  it.each([
    ['blank business name', { businessName: ' ' }, 'businessName'],
    ['invalid email', { businessName: 'Vendor', email: 'sales at vendor' }, 'email'],
    ['invalid phone', { businessName: 'Vendor', phone: '1234' }, 'phone'],
    ['invalid PIN', { businessName: 'Vendor', pin: '012345' }, 'pin'],
    ['invalid GSTIN', { businessName: 'Vendor', gstin: '27INVALID' }, 'gstin'],
    [
      'oversized notes',
      { businessName: 'Vendor', notes: '₹'.repeat(1_001) },
      'notes',
    ],
    [
      'control characters',
      { businessName: 'Vendor\u0000', notes: 'Safe' },
      'businessName',
    ],
  ])('rejects %s', (_label, input, field) => {
    expect(() => validateSupplierCreateInput(input)).toThrow(
      SupplierValidationError,
    );
    try {
      validateSupplierCreateInput(input);
    } catch (error) {
      expect(error).toMatchObject({ errors: { [field]: expect.any(Array) } });
    }
  });

  it('accepts null or blank optional fields as null', () => {
    expect(
      validateSupplierCreateInput({
        businessName: 'Vendor',
        contactName: '',
        phone: null,
        whatsappNumber: ' ',
        email: null,
        addressLine: '',
        city: null,
        state: '',
        pin: null,
        gstin: '',
        notes: null,
      }),
    ).toEqual({
      businessName: 'Vendor',
      contactName: null,
      phone: null,
      whatsappNumber: null,
      email: null,
      addressLine: null,
      city: null,
      state: null,
      pin: null,
      gstin: null,
      notes: null,
      isActive: true,
      relationshipType: 'CURRENT',
      capabilities: { v: 1, categories: [], items: [] },
    });
  });

  it('validates partial updates while rejecting empty and server-owned changes', () => {
    expect(
      validateSupplierUpdateInput({
        email: ' NEW@VENDOR.IN ',
        notes: null,
        isActive: false,
      }),
    ).toEqual({
      email: 'new@vendor.in',
      notes: null,
      isActive: false,
    });
    expect(() => validateSupplierUpdateInput({})).toThrow(
      SupplierValidationError,
    );
    for (const forbidden of [
      'tenantId', 'verificationStatus', 'applicationRequestId',
      'verifiedAt', 'verifiedByUserId',
    ]) {
      expect(() => validateSupplierUpdateInput({ [forbidden]: 'forbidden' }))
        .toThrow(SupplierValidationError);
    }
    expect(() => validateSupplierCreateInput({
      businessName: 'Applicant', relationshipType: 'APPLICANT',
    })).toThrow(SupplierValidationError);
  });

  it('accepts only server-owned direct and applicant lifecycle states', () => {
    const pending = {
      relationshipType: 'APPLICANT' as const,
      verificationStatus: 'PENDING' as const,
      applicationRequestId: 'request-a',
      verifiedAt: null,
      verifiedByUserId: null,
      isActive: false,
    };
    expect(validateSupplierLifecycleState(pending)).toEqual(pending);
    expect(() => validateSupplierLifecycleState({ ...pending, isActive: true }))
      .toThrow(SupplierValidationError);
    expect(() => validateSupplierLifecycleState({
      ...pending,
      relationshipType: 'CURRENT',
      applicationRequestId: null,
    })).toThrow(SupplierValidationError);
  });

  it('bounds active filters, search, limits, and opaque cursor size', () => {
    expect(
      validateSupplierListInput({
        active: undefined,
        search: '  tomato  ',
        limit: undefined,
        cursor: undefined,
      }),
    ).toEqual({ active: true, search: 'tomato', limit: 25, cursor: undefined });
    expect(
      validateSupplierListInput({ active: 'all', limit: 50 }),
    ).toEqual({ active: null, search: undefined, limit: 50, cursor: undefined });

    expect(() => validateSupplierListInput({ active: 'maybe' })).toThrow(
      SupplierValidationError,
    );
    expect(() => validateSupplierListInput({ limit: 51 })).toThrow(
      SupplierValidationError,
    );
    expect(() =>
      validateSupplierListInput({ search: 'a'.repeat(SUPPLIER_LIMITS.searchBytes + 1) }),
    ).toThrow(SupplierValidationError);
    expect(() =>
      validateSupplierListInput({ cursor: 'x'.repeat(SUPPLIER_LIMITS.cursorBytes + 1) }),
    ).toThrow(SupplierValidationError);
  });
});
