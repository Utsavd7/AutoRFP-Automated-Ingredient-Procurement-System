import { expect, test, type Page } from '@playwright/test';

const publicJourneySizes = [
  { name: 'laptop', width: 1440, height: 960 },
  { name: 'tablet', width: 900, height: 1112 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'small phone', width: 320, height: 720 },
];

const publicJourneyHeadings = [
  'Tell us what your kitchen needs',
  'Choose who should send prices',
  'Send one clear request',
  'Compare the complete cost',
  'Choose and save the decision',
] as const;

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('public landing responsive contract', () => {
  test('supports the public decision journey from laptop to phone', async ({ page }) => {
    for (const size of publicJourneySizes) {
      await test.step(size.name, async () => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto('/');

        const header = page.getByRole('banner');
        const hero = page.locator('.public-hero');
        const closingCta = page.locator('.public-cta');
        const productCta = hero.getByRole('link', { name: 'See the product', exact: true });
        const story = page.locator('.landing-story');
        const firstScene = page.locator('.story-scene').first();

        await expect(page.getByRole('heading', { level: 1, name: /Send one list/i })).toBeVisible();
        await expect(page.getByRole('heading', {
          level: 2,
          name: "From today's menu to tomorrow's order.",
        })).toBeVisible();
        for (const heading of publicJourneyHeadings) {
          await expect(page.getByRole('heading', { level: 3, name: heading })).toBeVisible();
        }
        await expect(page.getByRole('heading', { level: 4, name: 'Quote comparison' })).toBeVisible();
        await expect(page.getByText('Human decision required', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Sample decision facts')).toBeVisible();
        await expect(page.getByRole('heading', {
          level: 2,
          name: 'Your recipes stay private with your restaurant.',
        })).toBeVisible();
        await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible();
        await expect(header.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
        await expect(productCta).toBeVisible();
        await expect(productCta).toHaveAttribute('href', '/product');
        await expect(
          closingCta.getByRole('link', { name: 'Start free pilot', exact: true }),
        ).toHaveAttribute('href', '/start');
        await expect(
          closingCta.getByRole('link', { name: 'See the product', exact: true }),
        ).toHaveAttribute('href', '/product');
        await expect(page.getByRole('link', { name: /Review & award/i })).toHaveAttribute(
          'href',
          '/product#compare',
        );

        expect(await story.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
          'rgb(16, 24, 23)',
        );
        const sceneColumnCount = await firstScene.evaluate((element) => (
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
        ));
        expect(sceneColumnCount).toBe(size.name === 'laptop' ? 2 : 1);

        if (size.name === 'laptop') {
          await expect(header.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
          await expect(header.getByRole('link', { name: 'Product' })).toBeVisible();
          await expect(header.getByRole('link', { name: 'Product' })).toHaveAttribute('href', '/product');
          await expect(header.getByRole('link', { name: 'How it works' })).toBeVisible();
          await expect(header.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#how-it-works');
          await expect(header.getByRole('link', { name: 'Security' })).toBeVisible();
          await expect(header.getByRole('link', { name: 'Security' })).toHaveAttribute('href', '#security');
          await expect(header.getByRole('link', { name: 'Start a pilot' })).toBeVisible();
          await expect(header.getByRole('link', { name: 'Start a pilot' })).toHaveAttribute('href', '/start');
        } else if (size.name === 'tablet') {
          await expect(header.getByRole('link', { name: 'Start a pilot' })).toBeVisible();
          await expect(header.getByRole('link', { name: 'Start a pilot' })).toHaveAttribute('href', '/start');
        }

        await expectNoPageOverflow(page);

        await productCta.click();
        await expect(page).toHaveURL(/\/product$/);
        await expect(page.getByRole('heading', { level: 1, name: /A clean path from/i })).toBeVisible();
        await expect(page.getByRole('group', { name: 'Illustrative request workspace' })).toBeVisible();
        await expect(page.getByText('Sample data · illustrative only', { exact: true }).first()).toBeVisible();

        const comparisonHeading = page.getByRole('heading', {
          level: 2,
          name: 'Compare the facts before you award.',
        });
        await expect(comparisonHeading).toBeVisible();
        expect(await comparisonHeading.evaluate((heading) => heading.closest('section')?.id)).toBe('compare');
        await expectNoPageOverflow(page);
      });
    }
  });

  test('keeps the hero type monotonic across the mobile breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 621, height: 900 });
    await page.goto('/');

    const desktopHeading = page.getByRole('heading', { level: 1, name: /Send one list/i });
    await expect(desktopHeading).toBeVisible();
    const fontSizeAt621 = await desktopHeading.evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).fontSize)
    ));
    await page.setViewportSize({ width: 620, height: 900 });
    await page.reload();

    const mobileHeading = page.getByRole('heading', { level: 1, name: /Send one list/i });
    await expect(mobileHeading).toBeVisible();
    const fontSizeAt620 = await mobileHeading.evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).fontSize)
    ));
    expect(fontSizeAt620).toBeLessThanOrEqual(fontSizeAt621 + 0.25);
  });

  test('shows the comparison cue exactly when the hero table overflows', async ({ page }) => {
    for (const width of [721, 720, 621, 620, 560, 559, 558, 557, 556, 555, 521, 520, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');

      const comparison = page.getByRole('region', {
        name: 'Sample supplier quote comparison',
      });
      const overflows = await comparison.evaluate((element) => (
        element.scrollWidth > element.clientWidth + 1
      ));
      const cueIsVisible = await page
        .getByText('Scroll to compare suppliers →', { exact: true })
        .isVisible();

      expect(cueIsVisible, `comparison cue at ${width}px`).toBe(overflows);
    }
  });

  test('keeps the complete route visible and removes route motion when requested', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const route = page.getByRole('group', { name: 'QuotePlate buying journey' });
    const connector = route.locator('.hero-route__connector').first();
    const routeNodes = route.locator(':scope > div');
    await expect(routeNodes).toHaveCount(4);
    for (const node of await routeNodes.all()) await expect(node).toBeVisible();
    expect(await connector.evaluate((element) => (
      getComputedStyle(element, '::after').animationName
    ))).toBe('hero-route-travel');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();

    await expect(routeNodes).toHaveCount(4);
    for (const node of await routeNodes.all()) await expect(node).toBeVisible();
    expect(await connector.evaluate((element) => (
      getComputedStyle(element, '::after').animationName
    ))).toBe('none');
    for (const heading of publicJourneyHeadings) {
      await expect(page.getByRole('heading', { level: 3, name: heading })).toBeVisible();
    }
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
    const supplierFooter = page.getByRole('article', {
      name: 'Sample supplier response',
    }).locator('footer');

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

    const footerLayout = await supplierFooter.evaluate((element) => {
      const style = getComputedStyle(element);
      return { alignItems: style.alignItems, flexDirection: style.flexDirection };
    });
    expect(footerLayout).toEqual({ alignItems: 'flex-start', flexDirection: 'column' });
  });
});
