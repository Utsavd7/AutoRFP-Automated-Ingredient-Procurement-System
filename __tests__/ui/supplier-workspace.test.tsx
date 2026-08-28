import { renderToStaticMarkup } from 'react-dom/server';

import { SupplierWorkspace } from '@/components/suppliers/SupplierWorkspace';

const supplier = {
  id: 'supplier-1',
  businessName: 'GreenLeaf Fresh Foods',
  contactName: 'Meera Shah',
  phone: '+919876543210',
  whatsappNumber: '+919876543210',
  email: 'orders@greenleaf.example',
  addressLine: 'APMC Market, Vashi',
  city: 'Navi Mumbai',
  state: 'Maharashtra',
  pin: '400703',
  gstin: '27ABCDE1234F1Z5',
  notes: 'Morning delivery before 8:00 AM',
  isActive: true,
  createdAt: '2026-08-28T08:00:00.000Z',
  updatedAt: '2026-08-28T08:00:00.000Z',
};

describe('supplier workspace', () => {
  it('uses plain language, real supplier details, and accessible actions', () => {
    const html = renderToStaticMarkup(
      <SupplierWorkspace
        initialSuppliers={[supplier]}
        initialError=""
      />,
    );

    expect(html).toContain('Suppliers');
    expect(html).toContain('GreenLeaf Fresh Foods');
    expect(html).toContain('Navi Mumbai');
    expect(html).toContain('Add supplier');
    expect(html).toContain('Import CSV');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Search by name, phone, email, city or GSTIN');
    expect(html).toContain('aria-label="Edit GreenLeaf Fresh Foods"');
    expect(html).toContain('Active');
    expect(html).not.toContain('Verified');
    expect(html).not.toContain('AutoRFP');
    expect(html).not.toContain('violet');
  });

  it('renders a useful empty state with one clear next action', () => {
    const html = renderToStaticMarkup(
      <SupplierWorkspace initialSuppliers={[]} initialError="" />,
    );

    expect(html).toContain('Add your first supplier');
    expect(html).toContain('No supplier account is needed');
  });

  it('keeps load failures recoverable', () => {
    const html = renderToStaticMarkup(
      <SupplierWorkspace
        initialSuppliers={[]}
        initialError="We could not load suppliers."
      />,
    );

    expect(html).toContain('We could not load suppliers.');
    expect(html).toContain('Try again');
  });

  it('offers the next real API page when a cursor is available', () => {
    const Workspace = SupplierWorkspace as unknown as React.ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      <Workspace initialSuppliers={[]} initialError="" initialNextCursor="supplier-page-2" />,
    );

    expect(html).toContain('Load more suppliers');
  });
});
