import { expect, test } from '@playwright/test';

import { supplierSearchDocument, SUPPLIER_SEARCH_SANDBOX } from '../../src/lib/suppliers/google-search-element';

test('the search frame cannot read restaurant DOM or storage and treats search text as data', async ({ page }) => {
  const query = 'पनीर </script><script>parent.compromised=true</script> Mumbai';
  await page.route('**/supplier-search-sandbox-fixture', (route) => route.fulfill({
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' },
    body: '<!doctype html><html><body><p id="tenant-private">Private restaurant fixture</p></body></html>',
  }));
  await page.route('https://cse.google.com/cse.js?*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const checks = {};
      try { parent.document.getElementById('tenant-private').textContent; checks.parentDom = 'readable'; } catch (_) { checks.parentDom = 'blocked'; }
      try { parent.localStorage.getItem('restaurant-private'); checks.parentStorage = 'readable'; } catch (_) { checks.parentStorage = 'blocked'; }
      try { localStorage.getItem('restaurant-private'); checks.frameStorage = 'readable'; } catch (_) { checks.frameStorage = 'blocked'; }
      window.google = {search:{cse:{element:{
        render: function () {},
        getElement: function () { return {execute: function (query) {
          const result = document.createElement('p'); result.id = 'test-result'; result.textContent = query;
          result.dataset.checks = JSON.stringify(checks); document.getElementById('results').appendChild(result);
          window.__gcse.searchCallbacks.web.rendered();
        }};}
      }}}};
      window.__gcse.initializationCallback();
    `,
  }));
  await page.goto('/supplier-search-sandbox-fixture');
  await page.evaluate(() => localStorage.setItem('restaurant-private', 'Private supplier fixture'));
  await page.evaluate(({ document, sandbox }) => {
    const frame = window.document.createElement('iframe');
    frame.title = 'Supplier search test';
    frame.setAttribute('sandbox', sandbox);
    frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = document;
    window.document.body.appendChild(frame);
  }, { document: supplierSearchDocument('test_engine', query)!, sandbox: SUPPLIER_SEARCH_SANDBOX });
  const result = page.frameLocator('iframe').locator('#test-result');
  await expect(result).toHaveText(query);
  expect(JSON.parse((await result.getAttribute('data-checks'))!)).toEqual({
    parentDom: 'blocked', parentStorage: 'blocked', frameStorage: 'blocked',
  });
  expect(await page.evaluate(() => (window as Window & { compromised?: boolean }).compromised)).toBeUndefined();
  await expect(page.locator('#tenant-private')).toHaveText('Private restaurant fixture');
});

test('a blocked Google script reports failure instead of leaving an endless load', async ({ page }) => {
  await page.route('https://cse.google.com/cse.js?*', (route) => route.abort());
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.evaluate(({ document, sandbox }) => {
    const frame = window.document.createElement('iframe');
    frame.title = 'Unavailable supplier search test';
    frame.setAttribute('sandbox', sandbox);
    frame.srcdoc = document;
    window.document.body.appendChild(frame);
  }, { document: supplierSearchDocument('test_engine', 'Paneer Mumbai')!, sandbox: SUPPLIER_SEARCH_SANDBOX });
  await expect(page.frameLocator('iframe').getByRole('status')).toBeVisible();
  await expect(page.frameLocator('iframe').getByRole('status')).toContainText('Combined search could not load');
});
