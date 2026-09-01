import { renderToStaticMarkup } from 'react-dom/server';

import { HistoryWorkspace } from '@/components/reporting/HistoryWorkspace';
import { InsightsWorkspace } from '@/components/reporting/InsightsWorkspace';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe('reporting workspaces', () => {
  it('labels observed supplier evidence without invented savings or forecasts', () => {
    const html = renderToStaticMarkup(<InsightsWorkspace initialData={{
      generatedAt: '2026-08-28T12:00:00.000Z', capped: false,
      summary: { requestSampleSize: 4, supplierRequestsSent: 12, supplierResponses: 9, responseRatePercent: '75', quoteLinesExpected: 40, quoteLinesFullyCovered: 34, quotedLineCoveragePercent: '85', awardedRequestCount: 3, totalAwardedPaise: '4526000' },
      priceRanges: [{ itemName: 'Tomato', unit: 'KILOGRAM', quoteCount: 3, minimumUnitRatePaise: '4200', maximumUnitRatePaise: '5100', minimumSupplierName: 'GreenLeaf', maximumSupplierName: 'Shakti Foods', observedVariancePercent: '21.43' }],
      historyGuidance: [{ itemKey: 'tomato', itemName: 'Tomato', unit: 'KILOGRAM', lastOrderedQuantity: '90', lastOrderedAt: '2026-08-20T10:00:00.000Z', lastSupplierNames: ['GreenLeaf'], seasonalNotice: null, unusualQuantityNotice: 'Quantity check: this is more than twice recent orders.' }],
      notes: ['Observed ranges compare submitted quotes; they are not savings claims or automatic recommendations.'],
    }} />);
    expect(html).toContain('Submitted facts only');
    expect(html).toContain('75%');
    expect(html).toContain('₹45,260.00');
    expect(html).toContain('₹42.00');
    expect(html).toContain('range, not savings');
    expect(html).toContain('Previous buying guidance');
    expect(html).toContain('Last ordered 90 kg');
    expect(html).toContain('GreenLeaf');
    expect(html).toContain('Quantity check');
    expect(html).not.toContain('forecast');
    expect(html).not.toContain('recommended supplier');
  });

  it('shows permanent history and offers an awarded request as a new draft', () => {
    const html = renderToStaticMarkup(<HistoryWorkspace initialPage={{
      nextCursor: null,
      requests: [{ id: 'request-1', title: 'Fresh produce · Week 36', status: 'AWARDED', version: 3, deliveryDate: '2026-09-05', quoteDeadline: '2026-09-03T10:00:00.000Z', createdAt: '2026-08-28T08:00:00.000Z', openedAt: '2026-08-28T08:05:00.000Z', awardedAt: '2026-08-28T10:00:00.000Z', _count: { items: 8, supplierRequests: 3 }, respondingSupplierCount: 2, quoteRevisionCount: 5, award: { id: 'award-1', totalPaise: '9182949', createdAt: '2026-08-28T10:00:00.000Z', supplierCount: 1 } }],
      recentQuoteRevisions: [{ id: 'quote-5', requestId: 'request-1', requestTitle: 'Fresh produce · Week 36', supplierName: 'GreenLeaf Foods', revision: 3, submittedAt: '2026-08-28T09:45:00.000Z', totalPaise: '7968000' }],
      recentActivity: [{ id: 'audit-1', label: 'Award recorded', actorName: 'Neha Singh', createdAt: '2026-08-28T10:00:00.000Z' }],
    }} />);
    expect(html).toContain('Permanent buying record');
    expect(html).toContain('Fresh produce · Week 36');
    expect(html).toContain('₹91,829.49');
    expect(html).toContain('Run again');
    expect(html).toContain('Awarded');
    expect(html).toContain('2 replied');
    expect(html).toContain('5');
    expect(html).toContain('Quote versions');
    expect(html).toContain('Version 3');
    expect(html).toContain('GreenLeaf Foods');
    expect(html).toContain('Recent activity');
    expect(html).toContain('Award recorded');
    expect(html).not.toContain('metadata');
  });
});
