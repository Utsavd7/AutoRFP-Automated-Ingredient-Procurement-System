import { renderToStaticMarkup } from 'react-dom/server';

import { NewRequestForm } from '@/components/procurement/NewRequestForm';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('new procurement request', () => {
  it('collects approved demand, suppliers, delivery, deadline and terms', () => {
    const html = renderToStaticMarkup(
      <NewRequestForm
        initialData={{
          menus: [{ id: 'menu-1', name: 'Dinner menu', status: 'APPROVED', version: 3, _count: { recipes: 12, requests: 0 } }],
          suppliers: [{ id: 'supplier-1', businessName: 'GreenLeaf Fresh Foods', contactName: 'Meera Shah', phone: '+919876543210', email: null, city: 'Navi Mumbai', isActive: true }],
          account: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
          menuNextCursor: 'menu-page-2',
          supplierNextCursor: 'supplier-page-2',
        }}
      />,
    );

    expect(html).toContain('New procurement request');
    expect(html).toContain('Dinner menu');
    expect(html).toContain('GreenLeaf Fresh Foods');
    expect(html).toContain('18 Market Road');
    expect(html).toContain('Quote deadline');
    expect(html).toContain('Delivery date');
    expect(html).toContain('Save draft');
    expect(html).toContain('Nothing is shared yet');
    expect(html).toContain('Load more approved menus');
    expect(html).toContain('Load more suppliers');
  });
});
