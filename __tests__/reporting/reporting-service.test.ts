import {
  buildHistoryActivity,
  buildFactualInsights,
  decodeHistoryCursor,
  encodeHistoryCursor,
  ReportingValidationError,
} from '@/lib/reporting/reporting-service';

describe('factual reporting', () => {
  it('calculates response, complete-line coverage, awarded value, and observed price ranges from submitted facts', () => {
    const result = buildFactualInsights({
      requests: [{
        items: [{ id: 'tomato', itemKey: 'tomato', name: 'Tomato', quantity: '100', unit: 'KILOGRAM' }],
        supplierRequests: [
          { supplierName: 'A Produce', latestQuote: { id: 'quote-a', items: [{ requestItemId: 'tomato', noQuote: false, availableQuantity: '100', unit: 'KILOGRAM', unitRatePaise: '5000' }] } },
          { supplierName: 'B Produce', latestQuote: { id: 'quote-b', items: [{ requestItemId: 'tomato', noQuote: false, availableQuantity: '100000', unit: 'GRAM', unitRatePaise: '6' }] } },
          { supplierName: 'C Produce', latestQuote: null },
        ],
      }],
      awardedRequestCount: 3,
      totalAwardedPaise: '2500000',
      capped: false,
      generatedAt: new Date('2026-08-28T12:00:00Z'),
      historyGuidance: [{
        itemKey: 'tomato', itemName: 'Tomato', unit: 'KILOGRAM',
        lastOrderedQuantity: '100', lastOrderedAt: '2026-08-20T12:00:00.000Z',
        lastSupplierNames: ['A Produce'], seasonalNotice: null,
        unusualQuantityNotice: null,
      }],
    });

    expect(result.summary).toEqual({
      requestSampleSize: 1,
      supplierRequestsSent: 3,
      supplierResponses: 2,
      responseRatePercent: '66.7',
      quoteLinesExpected: 2,
      quoteLinesFullyCovered: 2,
      quotedLineCoveragePercent: '100',
      awardedRequestCount: 3,
      totalAwardedPaise: '2500000',
    });
    expect(result.priceRanges).toEqual([expect.objectContaining({
      itemName: 'Tomato', unit: 'KILOGRAM', quoteCount: 2,
      minimumUnitRatePaise: '5000', maximumUnitRatePaise: '6000',
      minimumSupplierName: 'A Produce', maximumSupplierName: 'B Produce',
      observedVariancePercent: '20',
    })]);
    expect(result.notes).toContain('Observed ranges compare submitted quotes; they are not savings claims or automatic recommendations.');
    expect(result.historyGuidance).toEqual([expect.objectContaining({
      itemKey: 'tomato', lastOrderedQuantity: '100', lastSupplierNames: ['A Produce'],
    })]);
  });

  it('does not invent percentages or price ranges when there is no submitted evidence', () => {
    const result = buildFactualInsights({
      requests: [], awardedRequestCount: 0, totalAwardedPaise: '0', capped: false,
      generatedAt: new Date('2026-08-28T12:00:00Z'),
    });
    expect(result.summary.responseRatePercent).toBeNull();
    expect(result.summary.quotedLineCoveragePercent).toBeNull();
    expect(result.priceRanges).toEqual([]);
  });

  it('round-trips a bounded cursor and rejects malformed or oversized cursor input', () => {
    const cursor = encodeHistoryCursor({
      snapshot: new Date('2026-08-28T12:00:00Z'),
      createdAt: new Date('2026-08-27T12:00:00Z'),
      id: 'request-1',
    });
    expect(decodeHistoryCursor(cursor)).toEqual({
      snapshot: new Date('2026-08-28T12:00:00Z'),
      createdAt: new Date('2026-08-27T12:00:00Z'),
      id: 'request-1',
    });
    expect(() => decodeHistoryCursor('not-a-cursor')).toThrow(ReportingValidationError);
    expect(() => decodeHistoryCursor('x'.repeat(2_000))).toThrow(ReportingValidationError);
  });

  it('turns only allow-listed audit actions into plain-language activity without exposing metadata', () => {
    const activity = buildHistoryActivity([
      {
        id: 'audit-1', action: 'request.awarded',
        createdAt: new Date('2026-08-28T12:00:00.000Z'),
        actor: { name: 'Neha Singh' },
        metadata: { reason: 'private internal note', supplierCount: 2 },
      },
      {
        id: 'audit-2', action: 'quote.submitted',
        createdAt: new Date('2026-08-28T11:30:00.000Z'), actor: null,
        metadata: { revision: 3, itemCount: 8 },
      },
      {
        id: 'audit-3', action: 'internal.unexpected',
        createdAt: new Date('2026-08-28T11:00:00.000Z'),
        actor: { name: 'Hidden' }, metadata: { token: 'do-not-return' },
      },
    ]);

    expect(activity).toEqual([
      {
        id: 'audit-1', label: 'Award recorded', actorName: 'Neha Singh',
        createdAt: '2026-08-28T12:00:00.000Z',
      },
      {
        id: 'audit-2', label: 'Supplier sent quote version 3', actorName: 'Supplier',
        createdAt: '2026-08-28T11:30:00.000Z',
      },
    ]);
    expect(JSON.stringify(activity)).not.toMatch(/private internal note|do-not-return|SupplierQuote|Secret/);
  });
});
