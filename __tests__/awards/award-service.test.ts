import {
  AWARD_MAX_SELECTIONS,
  AwardValidationError,
  validateAwardInput,
} from '@/lib/awards/award-service';

const whole = {
  mode: 'WHOLE',
  expectedRequestVersion: 2,
  supplierRequestId: 'supplier-request-a',
  quoteRevision: 3,
  rationale: 'The supplier confirmed full stock and the required delivery date.',
} as const;

const split = {
  mode: 'SPLIT',
  expectedRequestVersion: 2,
  rationale: 'Split across confirmed stock while preserving one delivery window.',
  selections: [
    {
      requestItemId: 'tomato',
      supplierRequestId: 'supplier-request-a',
      quoteRevision: 3,
      quantity: '75',
    },
    {
      requestItemId: 'tomato',
      supplierRequestId: 'supplier-request-b',
      quoteRevision: 1,
      quantity: '25',
    },
  ],
} as const;

describe('compact award decision input', () => {
  it('accepts only an explicit whole supplier-request revision or split allocation decision', () => {
    expect(validateAwardInput(whole)).toEqual(whole);
    expect(validateAwardInput(split)).toEqual(split);
  });

  it.each([
    'supplierId',
    'unitRatePaise',
    'gstBasisPoints',
    'subtotalPaise',
    'gstPaise',
    'totalPaise',
    'freightPaise',
    'unit',
    'specification',
    'tenantId',
    'awardedByUserId',
  ])('rejects client-derived %s', (field) => {
    expect(() => validateAwardInput({ ...whole, [field]: 'client fact' })).toThrow(
      AwardValidationError,
    );
    expect(() => validateAwardInput({
      ...split,
      selections: [{ ...split.selections[0], [field]: 'client fact' }],
    })).toThrow(AwardValidationError);
  });

  it('requires a bounded rationale and an exact positive latest quote revision', () => {
    for (const candidate of [
      { ...whole, rationale: '' },
      { ...whole, rationale: 'x'.repeat(501) },
      { ...whole, quoteRevision: undefined },
      { ...whole, quoteRevision: 0 },
      { ...whole, quoteRevision: 1.5 },
      { ...split, selections: [{ ...split.selections[0], quantity: '1.0001' }] },
      { ...split, selections: [] },
    ]) {
      expect(() => validateAwardInput(candidate)).toThrow(AwardValidationError);
    }
  });

  it('rejects duplicate allocation identities and non-plain/accessor input', () => {
    expect(() => validateAwardInput({
      ...split,
      selections: [split.selections[0], { ...split.selections[0] }],
    })).toThrow(AwardValidationError);

    const inherited = Object.assign(Object.create({ tenantId: 'polluted' }), whole);
    const accessor = { ...whole } as Record<string, unknown>;
    Object.defineProperty(accessor, 'rationale', {
      enumerable: true,
      get: () => 'hidden',
    });
    for (const candidate of [inherited, accessor]) {
      expect(() => validateAwardInput(candidate)).toThrow(AwardValidationError);
    }
  });

  it('accepts the 2,000-line boundary and rejects one more line', () => {
    const selections = Array.from({ length: AWARD_MAX_SELECTIONS }, (_, index) => ({
      requestItemId: `item-${index}`,
      supplierRequestId: 'supplier-request-a',
      quoteRevision: 3,
      quantity: '0.001',
    }));
    const boundary = validateAwardInput({ ...split, selections });
    expect(boundary.mode).toBe('SPLIT');
    if (boundary.mode === 'SPLIT') {
      expect(boundary.selections).toHaveLength(AWARD_MAX_SELECTIONS);
    }
    expect(() => validateAwardInput({
      ...split,
      selections: [...selections, { ...selections[0]!, requestItemId: 'overflow' }],
    })).toThrow(AwardValidationError);
  });
});
