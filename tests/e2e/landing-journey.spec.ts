import { expect, test } from '@playwright/test';

const names = ['Menu', 'Suppliers', 'Request', 'Compare', 'Decision'];

test('old product bookmarks lead to the homepage journey', async ({ page }) => {
  await page.goto('/product');
  await expect(page).toHaveURL(/\/#how-it-works$/);
  await expect(page.locator('a[href^="/product"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: "From today's menu to tomorrow's order." })).toBeVisible();
});

test('manual steps expose only their content and support keyboard navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const stage = page.locator('[data-enhanced="true"]');
  const buttons = page.getByRole('navigation', { name: 'Buying journey steps' }).getByRole('button');
  await expect(stage).toHaveAttribute('data-pinned', 'false');
  for (let index = 0; index < names.length; index += 1) {
    await buttons.nth(index).click();
    await expect(buttons.nth(index)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator(`#journey-step-${index + 1}`)).toBeVisible();
    await expect(page.locator('.story-scene:not([inert])')).toHaveCount(1);
    await expect(page.locator('.landing-story__track')).toHaveCSS('transition-duration', '0s');
  }
  await buttons.nth(3).click();
  const comparison = page.getByRole('region', { name: 'Sample supplier quote comparison' });
  await comparison.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  const lastColumn = comparison.locator('thead th').last();
  expect(await lastColumn.evaluate((element) => {
    const viewport = element.closest('[role="region"]')!.getBoundingClientRect();
    const column = element.getBoundingClientRect();
    return column.left >= viewport.left - 1 && column.right <= viewport.right + 1;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await buttons.last().focus();
  await page.keyboard.press('Home');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(buttons.nth(1)).toBeFocused();
  await expect(buttons.nth(1)).toHaveAttribute('aria-current', 'step');
  await page.getByRole('link', { name: 'Skip journey' }).click();
  await expect(page).toHaveURL(/#benefits$/);
  await expect(page.locator('#benefits')).toBeInViewport();
});

test('desktop scrolling advances through five scenes then returns to normal scrolling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop scroll interaction');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const root = page.locator('[data-pinned="true"]');
  await expect(root).toBeVisible();
  const range = await root.evaluate((element) => ({
    start: element.getBoundingClientRect().top + scrollY,
    top: parseFloat(element.style.getPropertyValue('--stage-top')),
    travel: parseFloat(element.style.getPropertyValue('--scroll-travel')),
  }));
  for (let index = 0; index < names.length; index += 1) {
    await page.evaluate(({ range, index }) => window.scrollTo({
      top: range.start - range.top + range.travel * index / 4, behavior: 'instant',
    }), { range, index });
    await expect(page.getByRole('button', { name: names[index], exact: true })).toHaveAttribute('aria-current', 'step');
    await expect.poll(async () => (await page.locator(`#journey-step-${index + 1}`).boundingBox())!.x).toBeCloseTo(112, 0);
    expect(Math.abs((await root.locator(':scope > div').boundingBox())!.y - range.top)).toBeLessThan(2);
  }
  await page.mouse.wheel(0, 1100);
  await expect(page.locator('#benefits')).toBeInViewport();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-enhanced="true"]')).toHaveAttribute('data-pinned', 'false');
});

test('the complete journey remains readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  for (let index = 1; index <= 5; index += 1) {
    await expect(page.locator(`#journey-step-${index}`)).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Buying journey steps' })).toBeHidden();
  await context.close();
});
