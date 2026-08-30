import { expect, test } from '@playwright/test';

test.describe('public landing responsive contract', () => {
  test('keeps the hero type monotonic across the mobile breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 621, height: 900 });
    await page.goto('/');

    const desktopHeading = page.getByRole('heading', { level: 1, name: /Compare every quote/i });
    await expect(desktopHeading).toBeVisible();
    const fontSizeAt621 = await desktopHeading.evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).fontSize)
    ));

    await page.setViewportSize({ width: 620, height: 900 });
    await page.reload();

    const mobileHeading = page.getByRole('heading', { level: 1, name: /Compare every quote/i });
    await expect(mobileHeading).toBeVisible();
    const fontSizeAt620 = await mobileHeading.evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).fontSize)
    ));

    expect(fontSizeAt620).toBeLessThanOrEqual(fontSizeAt621 + 0.25);
  });

  test('keeps sample decision facts readable without page overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const pageHasNoHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ));
    expect(pageHasNoHorizontalOverflow).toBe(true);

    const tableFontSize = await page.locator('.decision-preview__table').evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).fontSize)
    ));
    expect(tableFontSize).toBeGreaterThanOrEqual(10.5);

    const sampleCaptionFontSize = await page.locator('.decision-preview figcaption').evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).fontSize)
    ));
    expect(sampleCaptionFontSize).toBeGreaterThanOrEqual(10);

    await expect(page.getByText('Human decision required', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Sample decision facts')).toBeVisible();
  });
});

test.describe('public product tour responsive contract', () => {
  test('shows every comparison column and readable supplier facts at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/product');

    const comparisonWorkspace = page.getByRole('group', {
      name: 'Illustrative comparison workspace',
    });
    const comparison = page.getByRole('region', {
      name: 'Sample supplier quote comparison',
    });
    const finalSupplier = comparison.getByRole('columnheader', {
      name: 'Deccan Kitchen Supply',
    });
    const supplierWorkspace = page.getByRole('group', {
      name: 'Illustrative supplier response workspace',
    });

    await expect(comparison).toBeVisible();
    await expect(finalSupplier).toBeVisible();
    await expect(
      comparisonWorkspace.getByText('Scroll to compare all suppliers'),
    ).toBeHidden();

    const geometry = await comparison.evaluate((element) => {
      const finalHeader = element.querySelector('thead th:last-child');
      if (!(finalHeader instanceof HTMLElement)) throw new Error('Final supplier header is missing');
      const viewport = element.getBoundingClientRect();
      const finalColumn = finalHeader.getBoundingClientRect();
      return {
        comparisonOverflow: element.scrollWidth - element.clientWidth,
        documentOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        finalColumnVisible:
          finalColumn.left >= viewport.left - 1 && finalColumn.right <= viewport.right + 1,
      };
    });
    expect(geometry.comparisonOverflow).toBeLessThanOrEqual(1);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.finalColumnVisible).toBe(true);

    const labelFontSize = await supplierWorkspace.getByText('GST', { exact: true }).evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).fontSize),
    );
    const valueFontSize = await supplierWorkspace.getByText('₹759.50', { exact: true }).evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(labelFontSize).toBeGreaterThanOrEqual(11.15);
    expect(valueFontSize).toBeGreaterThanOrEqual(12.1);
  });

  test('contains the comparison scroll and keeps every supplier reachable at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/product');

    const comparisonWorkspace = page.getByRole('group', {
      name: 'Illustrative comparison workspace',
    });
    const comparison = page.getByRole('region', {
      name: 'Sample supplier quote comparison',
    });
    const finalSupplier = comparison.getByRole('columnheader', {
      name: 'Deccan Kitchen Supply',
    });
    const supplierWorkspace = page.getByRole('group', {
      name: 'Illustrative supplier response workspace',
    });

    await expect(comparison).toBeVisible();
    await expect(
      comparisonWorkspace.getByText('Scroll to compare all suppliers'),
    ).toBeVisible();

    const initialGeometry = await comparison.evaluate((element) => ({
      comparisonOverflow: element.scrollWidth - element.clientWidth,
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(initialGeometry.comparisonOverflow).toBeGreaterThan(1);
    expect(initialGeometry.documentOverflow).toBeLessThanOrEqual(1);

    await comparison.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const finalColumnVisible = await finalSupplier.evaluate((element) => {
      const viewport = element.closest('[role="region"]')?.getBoundingClientRect();
      if (!viewport) throw new Error('Comparison viewport is missing');
      const finalColumn = element.getBoundingClientRect();
      return finalColumn.left >= viewport.left - 1 && finalColumn.right <= viewport.right + 1;
    });
    expect(finalColumnVisible).toBe(true);

    const labelFontSize = await supplierWorkspace.getByText('GST', { exact: true }).evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).fontSize),
    );
    const valueFontSize = await supplierWorkspace.getByText('₹759.50', { exact: true }).evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(labelFontSize).toBeGreaterThanOrEqual(11.15);
    expect(valueFontSize).toBeGreaterThanOrEqual(12.1);
  });
});
