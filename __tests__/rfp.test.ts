import {
  buildActiveRfpSummary,
  getRfpStatusLabel,
  isActiveMenuWorkflowStatus,
  isActiveRfpStatus,
} from '@/lib/rfp';

describe('rfp lifecycle helpers', () => {
  it('recognizes active statuses and workflow stages', () => {
    expect(isActiveRfpStatus('SENT')).toBe(true);
    expect(isActiveRfpStatus('NEGOTIATING')).toBe(true);
    expect(isActiveRfpStatus('DECLINED')).toBe(false);
    expect(isActiveMenuWorkflowStatus('RFP_SENT')).toBe(true);
    expect(isActiveMenuWorkflowStatus('NEGOTIATION_COMPLETE')).toBe(false);
  });

  it('maps lifecycle labels for the workbench and dashboard', () => {
    expect(getRfpStatusLabel('VIEWED')).toBe('Supplier reviewing');
    expect(getRfpStatusLabel('REPLIED')).toBe('Quotes received');
    expect(getRfpStatusLabel('NEGOTIATING')).toBe('Negotiation live');
  });

  it('builds an active summary with real distributor and quote counts', () => {
    const summary = buildActiveRfpSummary({
      tenantId: 'tenant_123',
      restaurantName: 'The Oak Room',
      menu: {
        id: 'menu_123',
        createdAt: new Date('2026-05-01T12:00:00.000Z'),
        workflowStatus: 'RFP_SENT',
        requestedIngredients: [{ name: 'beef' }, { name: 'bun' }, { name: 'cheddar' }],
      },
      rfps: [
        {
          id: 'rfp_1',
          status: 'VIEWED',
          distributor: { name: 'Vendor A', location: 'New York' },
          quotes: [],
        },
        {
          id: 'rfp_2',
          status: 'REPLIED',
          distributor: { name: 'Vendor B', location: 'Brooklyn' },
          quotes: [{ id: 'quote_1', price: 420 }],
        },
      ],
    });

    expect(summary.id).toBe('menu_123');
    expect(summary.distributorsCount).toBe(2);
    expect(summary.quotesCount).toBe(1);
    expect(summary.ingredientsCount).toBe(3);
    expect(summary.status).toBe('Quotes received');
  });
});
