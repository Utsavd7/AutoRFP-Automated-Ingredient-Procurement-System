import { expect, test } from '@playwright/test';

const token = 'Q'.repeat(43);
const request = {
  restaurantName: 'Monsoon Table Pune',
  supplierName: 'Shakti Fresh Foods',
  title: 'Weekly vegetables and dairy',
  deliveryDetails: {
    addressLine: '18 Koregaon Park Road',
    city: 'Pune',
    state: 'Maharashtra',
    pin: '411001',
  },
  deliveryDate: '2099-09-02',
  quoteDeadline: '2099-09-01T10:00:00.000Z',
  commercialTerms: 'Rates must include packing.',
  items: [
    { id: 'tomato', name: 'Tomato', quantity: '100', unit: 'KILOGRAM' },
    { id: 'paneer', name: 'Paneer', quantity: '25.5', unit: 'KILOGRAM' },
  ],
  latestQuote: null,
};

test('scrubs the link, loads the real quote form, and submits a server-calculated revision', async ({
  page,
}) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/public/quote/access', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route('**/api/public/quote', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(request),
      });
      return;
    }
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        revision: 1,
        subtotalPaise: '1234567',
        gstPaise: '61728',
        freightPaise: '45000',
        totalPaise: '1341295',
        deliveryDate: '2099-09-02',
        validUntil: '2099-09-01',
        commercialTerms: 'Payment within 15 days',
        notes: null,
        submittedAt: '2026-08-28T10:00:00.000Z',
        items: [],
      }),
    });
  });

  await page.goto(`/quote#token=${token}`);
  await expect(page).toHaveURL(/\/quote$/);
  await expect(page.getByRole('heading', { name: request.title })).toBeVisible();
  await expect(page.getByText(request.restaurantName)).toBeVisible();
  await expect(page.getByText(request.supplierName)).toBeVisible();

  await page.locator('input[name="rate:tomato"]').fill('42');
  await page.locator('input[name="gst:tomato"]').fill('5');
  await page.locator('input[name="rate:paneer"]').fill('320');
  await page.locator('input[name="gst:paneer"]').fill('5');
  await page.locator('input[name="inclusive:paneer"]').check();
  await page.locator('input[name="freightInr"]').fill('450');
  await page.getByRole('button', { name: 'Submit quote' }).click();

  await expect(page.getByText('Revision 1 submitted successfully.')).toBeVisible();
  expect(submitted).toEqual(
    expect.objectContaining({
      expectedLatestRevision: 0,
      freightInr: '450',
      items: expect.arrayContaining([
        expect.objectContaining({
          requestItemId: 'tomato',
          unitRateInr: '42',
          gstPercent: '5',
        }),
        expect.objectContaining({
          requestItemId: 'paneer',
          unitRateInr: '320',
          taxInclusive: true,
        }),
      ]),
    }),
  );
  expect(JSON.stringify(submitted)).not.toMatch(/subtotalPaise|totalPaise|gstPaise/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
