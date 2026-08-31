import { PROCUREMENT_CATEGORIES } from '@/lib/domain/procurement-categories';
import {
  emptySupplierCapabilities,
  SupplierCapabilitiesValidationError,
  validateSupplierCapabilities,
} from '@/lib/suppliers/supplier-capabilities';

describe('supplier capabilities v1', () => {
  it('enforces the bounded canonical category, item, tier, and rank matrix', () => {
    expect(emptySupplierCapabilities()).toEqual({ v: 1, categories: [], items: [] });

    const canonical = validateSupplierCapabilities({
      v: 1,
      categories: [
        { category: 'FRUITS', tier: 'BACKUP', rank: 2 },
        { category: 'VEGETABLES', tier: 'PREFERRED', rank: 1 },
        { category: 'DAIRY', tier: 'BACKUP', rank: 1 },
      ],
      items: [
        { itemKey: 'urad-dal', itemName: 'Urad dal', tier: 'BACKUP', rank: 1 },
        { itemKey: 'tomato', itemName: 'Tomato', tier: 'PREFERRED', rank: 1 },
      ],
    });
    expect(canonical).toEqual({
      v: 1,
      categories: [
        { category: 'VEGETABLES', tier: 'PREFERRED', rank: 1 },
        { category: 'DAIRY', tier: 'BACKUP', rank: 1 },
        { category: 'FRUITS', tier: 'BACKUP', rank: 2 },
      ],
      items: [
        { itemKey: 'tomato', itemName: 'Tomato', tier: 'PREFERRED', rank: 1 },
        { itemKey: 'urad-dal', itemName: 'Urad dal', tier: 'BACKUP', rank: 1 },
      ],
    });

    const allCategories = Object.keys(PROCUREMENT_CATEGORIES).map(
      (category, index) => ({ category, tier: 'CAPABLE', rank: index + 1 }),
    );
    expect(validateSupplierCapabilities({ v: 1, categories: allCategories, items: [] })
      .categories).toHaveLength(22);

    const invalid = [
      { ...canonical, extra: true },
      { v: 1, categories: [{ category: 'VEGETABLES_HERBS', tier: 'CAPABLE', rank: 1 }], items: [] },
      { v: 1, categories: [
        { category: 'FRUITS', tier: 'PREFERRED', rank: 1 },
        { category: 'FRUITS', tier: 'BACKUP', rank: 1 },
      ], items: [] },
      { v: 1, categories: [
        { category: 'FRUITS', tier: 'PREFERRED', rank: 1 },
        { category: 'DAIRY', tier: 'PREFERRED', rank: 1 },
      ], items: [] },
      { v: 1, categories: [], items: [
        { itemKey: 'Fresh Tomato', itemName: 'Tomato', tier: 'PREFERRED', rank: 1 },
      ] },
      { v: 1, categories: [], items: [
        { itemKey: 'tomato', itemName: 'Tomato', tier: 'PREFERRED', rank: 1 },
        { itemKey: 'tomato', itemName: 'Tomatoes', tier: 'BACKUP', rank: 1 },
      ] },
      { v: 1, categories: [], items: Array.from({ length: 251 }, (_, index) => ({
        itemKey: `item-${index + 1}`,
        itemName: `Item ${index + 1}`,
        tier: 'PREFERRED',
        rank: index + 1,
      })) },
      { v: 1, categories: [], items: Array.from({ length: 250 }, (_, index) => ({
        itemKey: `item-${String(index + 1).padStart(3, '0')}-${'x'.repeat(68)}`,
        itemName: 'N'.repeat(160),
        tier: 'PREFERRED',
        rank: index + 1,
      })) },
    ];
    for (const document of invalid) {
      expect(() => validateSupplierCapabilities(document)).toThrow(
        SupplierCapabilitiesValidationError,
      );
    }
  });
});
