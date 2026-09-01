import { renderToStaticMarkup } from 'react-dom/server';

import { ProcurementWorkspace } from '@/components/procurement/ProcurementWorkspace';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('procurement workspace', () => {
  it('shows real request state without fabricated savings', () => {
    const html = renderToStaticMarkup(
      <ProcurementWorkspace
        initialRequests={[
          {
            id: 'request-1',
            title: 'Fresh produce · Week 36',
            status: 'OPEN',
            version: 2,
            deliveryDate: '2026-09-05T00:00:00.000Z',
            quoteDeadline: '2026-09-03T10:00:00.000Z',
            openedAt: '2026-08-28T08:00:00.000Z',
            awardedAt: null,
            createdAt: '2026-08-28T08:00:00.000Z',
            updatedAt: '2026-08-28T08:00:00.000Z',
            itemCount: 14,
            supplierCount: 4,
          },
        ]}
        initialError=""
      />,
    );

    expect(html).toContain('Procurement');
    expect(html).toContain('Fresh produce · Week 36');
    expect(html).toContain('14 items');
    expect(html).toContain('4 suppliers');
    expect(html).toContain('Open');
    expect(html).toContain('New request');
    expect(html).not.toContain('savings');
    expect(html).not.toContain('AI');
  });

  it('has a useful empty state', () => {
    const html = renderToStaticMarkup(
      <ProcurementWorkspace initialRequests={[]} initialError="" />,
    );

    expect(html).toContain('Create your first request');
    expect(html).toContain('approved menu');
  });

  it('offers the next real API page when a cursor is available', () => {
    const Workspace = ProcurementWorkspace as unknown as React.ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      <Workspace initialRequests={[]} initialError="" initialNextCursor="request-page-2" />,
    );

    expect(html).toContain('Load more requests');
  });
});
