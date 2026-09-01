import { renderToStaticMarkup } from 'react-dom/server';

import { rememberFragmentToken } from '@/app/supplier-application/SupplierApplicationAccess';
import { SupplierApplicationForm } from '@/app/supplier-application/SupplierApplicationForm';

test('supplier application form is plain, complete, and account free', () => {
  const html = renderToStaticMarkup(
    <SupplierApplicationForm token={'A'.repeat(43)} />,
  );

  expect(html).toContain('Become a supplier');
  expect(html).toContain('Business name');
  expect(html).toContain('Contact person');
  expect(html).toContain('Phone number');
  expect(html).toContain('WhatsApp number');
  expect(html).toContain('Email address');
  expect(html).toContain('What can you supply?');
  expect(html).toContain('Vegetables');
  expect(html).toContain('Fruits');
  expect(html).toContain('Dairy');
  expect(html).toContain('Coffee and tea');
  expect(html).toContain('Ready made food');
  expect(html).toContain('Send application');
  expect(html).toContain('No account needed');
  expect(html).not.toContain('Create account');
  expect(html).not.toContain('Ready-made');
});

test('keeps the private fragment token when development remounts the effect', () => {
  const token = 'A'.repeat(43);

  expect(rememberFragmentToken('', `#token=${token}`)).toBe(token);
  expect(rememberFragmentToken(token, '')).toBe(token);
});
