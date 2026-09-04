import { expect, test, type Page } from '@playwright/test';

const publicJourneySizes = [
  { name: 'laptop', width: 1440, height: 960 },
  { name: 'laptop compact', width: 1024, height: 900 },
  { name: 'tablet', width: 900, height: 1112 },
  { name: 'tablet narrow', width: 768, height: 1024 },
  { name: 'phone wide', width: 555, height: 900 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'small phone', width: 320, height: 720 },
];

const firstFoldSizes = [
  { name: 'large desktop', width: 1440, height: 960 },
  { name: 'standard desktop', width: 1366, height: 768 },
  { name: 'compact desktop', width: 1024, height: 900 },
] as const;

const publicJourneyHeadings = [
  'Tell us what your kitchen needs',
  'Choose who should send prices',
  'Send one clear request',
  'Compare the complete cost',
  'Choose and save the decision',
] as const;

const landingMotionSelectors = [
  '.intake-diagram',
  '.supplier-diagram',
  '.request-route',
  '.story-scene--comparison .decision-preview',
  '.decision-route',
  '.privacy-map',
] as const;

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}

async function measureHero(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((element) => {
    const heroBox = element.getBoundingClientRect();
    return {
      top: heroBox.top,
      right: heroBox.right,
      bottom: heroBox.bottom,
      left: heroBox.left,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      children: [...element.children].map((child) => {
        const box = child.getBoundingClientRect();
        return {
          name: child.getAttribute('class') ?? child.tagName.toLowerCase(),
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          left: box.left,
          clientHeight: child.clientHeight,
          clientWidth: child.clientWidth,
          scrollHeight: child.scrollHeight,
          scrollWidth: child.scrollWidth,
        };
      }),
    };
  });
}

async function renderedContrast(
  locator: ReturnType<Page['locator']>,
  backgroundSelector: string,
) {
  return locator.evaluate((element, selector) => {
    const parseColor = (value: string) => {
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [];
      const rgb = value.startsWith('color(srgb')
        ? numbers.slice(0, 3)
        : numbers.slice(0, 3).map((channel) => channel / 255);
      return { rgb, alpha: numbers[3] ?? 1 };
    };
    const background = element.closest(selector);
    if (!background) throw new Error(`Contrast background ${selector} is missing`);
    const foregroundColor = parseColor(getComputedStyle(element).color);
    const backgroundColor = parseColor(getComputedStyle(background).backgroundColor);
    const composited = foregroundColor.rgb.map((channel, index) => (
      channel * foregroundColor.alpha + backgroundColor.rgb[index] * (1 - foregroundColor.alpha)
    ));
    const luminance = (channels: number[]) => {
      const linear = channels.map((channel) => (
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      ));
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const values = [luminance(composited), luminance(backgroundColor.rgb)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  }, backgroundSelector);
}

test.describe('public landing responsive contract', () => {
  test('keeps the shared account-page header pinned on laptop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One project covers the viewport matrix');

    for (const path of ['/signin', '/start']) {
      for (const size of [{ width: 1440, height: 600 }, { width: 900, height: 600 }]) {
        await page.setViewportSize(size);
        await page.goto(path);
        const header = page.locator('.public-header');
        await expect(header).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect.poll(async () => Math.round((await header.boundingBox())?.y ?? -1)).toBe(0);
        await expectNoPageOverflow(page);
      }
    }
  });

  test('keeps all six restaurant benefits readable across screen sizes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One project covers the viewport matrix');

    for (const size of [
      { width: 1440, height: 960, columns: 3 },
      { width: 900, height: 1000, columns: 2 },
      { width: 390, height: 844, columns: 1 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/');
      const section = page.locator('.restaurant-benefits');
      await expect(section.getByRole('heading', {
        name: 'Useful for every purchase, not just the first one.',
      })).toBeVisible();
      await expect(section.locator('.restaurant-benefit')).toHaveCount(6);
      const columns = await section.locator('.restaurant-benefits__grid').evaluate((element) => (
        getComputedStyle(element).gridTemplateColumns.split(' ').length
      ));
      expect(columns).toBe(size.columns);
      await expectNoPageOverflow(page);
    }
  });

  test('pins the public header on home and product above phone width', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

    for (const route of ['/', '/product']) {
      await test.step(`${route} tablet`, async () => {
        await page.setViewportSize({ width: 900, height: 900 });
        await page.goto(route);
        await page.evaluate(() => window.scrollTo(0, 700));
        await expect.poll(() => page.getByRole('banner').evaluate((element) => (
          element.getBoundingClientRect().top
        ))).toBeGreaterThanOrEqual(-1);
      });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 700));
    expect(await page.getByRole('banner').evaluate((element) => (
      element.getBoundingClientRect().bottom
    ))).toBeLessThan(0);

    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/privacy');
    await page.evaluate(() => window.scrollTo(0, 700));
    expect(await page.getByRole('banner').evaluate((element) => (
      element.getBoundingClientRect().bottom
    ))).toBeLessThan(0);
  });

  test('gives every home story scene one measured desktop frame', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

    for (const size of firstFoldSizes) {
      await test.step(size.name, async () => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto('/');

        const frames = page.locator([
          '.landing-story__intro',
          '.story-scene',
          '.privacy-story__grid',
        ].join(', '));
        await expect(frames).toHaveCount(7);

        const measurements = await frames.evaluateAll((elements) => elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            name: element.className,
            height: box.height,
            verticalOverflow: element.scrollHeight - element.clientHeight,
            horizontalOverflow: element.scrollWidth - element.clientWidth,
          };
        }));
        for (const measurement of measurements) {
          expect(measurement.height, `${measurement.name} height`).toBeGreaterThanOrEqual(
            size.height - 2,
          );
          expect(measurement.verticalOverflow, `${measurement.name} vertical clipping`).toBeLessThanOrEqual(1);
          expect(measurement.horizontalOverflow, `${measurement.name} horizontal clipping`).toBeLessThanOrEqual(1);
        }

        const heroSize = await page.locator('.public-hero h1').evaluate((element) => (
          Number.parseFloat(getComputedStyle(element).fontSize)
        ));
        const introSize = await page.locator('.landing-story__intro h2').evaluate((element) => (
          Number.parseFloat(getComputedStyle(element).fontSize)
        ));
        const privacySize = await page.locator('.privacy-story h2').evaluate((element) => (
          Number.parseFloat(getComputedStyle(element).fontSize)
        ));
        const stepSizes = await page.locator('.story-scene__copy h3').evaluateAll((headings) => (
          headings.map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize))
        ));

        expect(introSize).toBeLessThanOrEqual(heroSize * 1.05);
        expect(privacySize).toBeLessThanOrEqual(heroSize * 0.9);
        for (const stepSize of stepSizes) expect(stepSize).toBeLessThanOrEqual(heroSize * 0.85);
        await expectNoPageOverflow(page);
      });
    }
  });

  test('keeps home story scenes naturally sized on short desktops', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

    await page.setViewportSize({ width: 1024, height: 650 });
    await page.goto('/');
    const frames = page.locator('.landing-story__intro, .story-scene, .privacy-story__grid');
    const minHeights = await frames.evaluateAll((elements) => (
      elements.map((element) => getComputedStyle(element).minHeight)
    ));
    expect(minHeights).not.toContain('650px');
    await expectNoPageOverflow(page);
  });

  test('fits the complete desktop hero before the first section line', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

    for (const size of firstFoldSizes) {
      await test.step(size.name, async () => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto('/');

        const hero = page.locator('.public-hero');
        await expect(page.getByRole('heading', { level: 1, name: /Send one list/i })).toBeVisible();
        await expect(page.getByRole('group', { name: 'QuotePlate buying journey' })).toBeVisible();
        await expect(page.getByText(
          'No supplier commission. No card required.',
          { exact: true },
        )).toBeVisible();

        const proofBandTop = await page.locator('.proof-band').evaluate((element) => (
          element.getBoundingClientRect().top
        ));
        expect(
          Math.abs(proofBandTop - size.height),
          `.proof-band fold offset at ${size.width}x${size.height}`,
        ).toBeLessThanOrEqual(2);

        const geometry = await measureHero(hero);
        expect(geometry.scrollHeight - geometry.clientHeight, 'hero clipped vertically').toBeLessThanOrEqual(1);
        expect(geometry.scrollWidth - geometry.clientWidth, 'hero clipped horizontally').toBeLessThanOrEqual(1);
        expect(geometry.children.length).toBeGreaterThan(0);
        for (const child of geometry.children) {
          expect(child.top, `${child.name} top at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(-1);
          expect(child.left, `${child.name} left at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(-1);
          expect(child.right, `${child.name} right at ${size.width}x${size.height}`).toBeLessThanOrEqual(
            size.width + 1,
          );
          expect(child.bottom, `${child.name} bottom at ${size.width}x${size.height}`).toBeLessThanOrEqual(
            size.height + 1,
          );
          expect(
            child.scrollHeight - child.clientHeight,
            `${child.name} clipped content at ${size.width}x${size.height}`,
          ).toBeLessThanOrEqual(1);
          expect(
            child.scrollWidth - child.clientWidth,
            `${child.name} horizontally clipped content at ${size.width}x${size.height}`,
          ).toBeLessThanOrEqual(1);
        }
      });
    }
  });

  test('keeps a short desktop hero at natural height without clipping', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

    const size = { width: 1024, height: 650 };
    await page.setViewportSize(size);
    await page.goto('/');

    const hero = page.locator('.public-hero');
    const proofBandTop = await page.locator('.proof-band').evaluate((element) => (
      element.getBoundingClientRect().top
    ));
    expect(proofBandTop).toBeGreaterThan(size.height);

    const geometry = await measureHero(hero);
    expect(geometry.scrollHeight - geometry.clientHeight, 'hero clipped vertically').toBeLessThanOrEqual(1);
    expect(geometry.scrollWidth - geometry.clientWidth, 'hero clipped horizontally').toBeLessThanOrEqual(1);
    expect(geometry.children.length).toBeGreaterThan(0);
    for (const child of geometry.children) {
      expect(child.top, `${child.name} top`).toBeGreaterThanOrEqual(geometry.top - 1);
      expect(child.left, `${child.name} left`).toBeGreaterThanOrEqual(geometry.left - 1);
      expect(child.right, `${child.name} right`).toBeLessThanOrEqual(geometry.right + 1);
      expect(child.bottom, `${child.name} bottom`).toBeLessThanOrEqual(geometry.bottom + 1);
      expect(child.scrollHeight - child.clientHeight, `${child.name} clipped vertically`).toBeLessThanOrEqual(1);
      expect(child.scrollWidth - child.clientWidth, `${child.name} clipped horizontally`).toBeLessThanOrEqual(1);
    }
  });

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
        const heroRoute = page.getByRole('group', { name: 'QuotePlate buying journey' });

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
        expect(await renderedContrast(
          page.locator('.privacy-story .public-eyebrow'),
          '.privacy-story',
        )).toBeGreaterThanOrEqual(4.5);
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
          'rgb(23, 37, 33)',
        );
        const sceneColumnCount = await firstScene.evaluate((element) => (
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
        ));
        expect(sceneColumnCount).toBe(size.width > 900 ? 2 : 1);
        const heroRouteColumnCount = await heroRoute.evaluate((element) => (
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
        ));
        expect(heroRouteColumnCount).toBe(size.width > 620 ? 7 : 1);

        const narrativeProse = page.locator([
          '.story-scene__copy p',
          '.privacy-story header > p:last-child',
          '.privacy-story__note',
          '.public-cta > div:last-child > p',
        ].join(', '));
        expect(await narrativeProse.count()).toBe(8);
        for (const paragraph of await narrativeProse.all()) {
          expect(await paragraph.evaluate((element) => (
            Number.parseFloat(getComputedStyle(element).fontSize)
          ))).toBeGreaterThanOrEqual(16);
        }

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
        } else if (size.width > 620) {
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
    for (const width of [721, 720, 621, 620, 560, 559, 558, 557, 556, 555, 521, 520, 390, 320]) {
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

  test('keeps the central comparison proof readable on its light surfaces', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/');

    const checks = [
      {
        locator: page.getByRole('heading', { level: 4, name: 'Quote comparison' }),
        surface: '.decision-preview__bar',
      },
      {
        locator: page.locator('.decision-preview__summary > div > strong'),
        surface: '.decision-preview__window',
      },
      {
        locator: page.locator('.decision-preview__table tbody tr:nth-child(2) th'),
        surface: '.decision-preview__window',
      },
    ];

    for (const check of checks) {
      await expect(check.locator).toBeVisible();
      expect(await renderedContrast(check.locator, check.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps every scene number clear of its operational visual when scenes stack', async ({ page }) => {
    for (const width of [768, 555]) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');

        const scenes = page.locator('.story-scene');
        await expect(scenes).toHaveCount(5);
        for (let index = 0; index < await scenes.count(); index += 1) {
          const intersects = await scenes.nth(index).evaluate((scene) => {
            const number = scene.querySelector('.story-scene__number');
            const visual = [...scene.children].find((child) => (
              !child.classList.contains('story-scene__copy')
            ));
            if (!(number instanceof HTMLElement) || !(visual instanceof HTMLElement)) {
              throw new Error('Scene number or operational visual is missing');
            }
            const numberBox = number.getBoundingClientRect();
            const visualBox = visual.getBoundingClientRect();
            return numberBox.left < visualBox.right
              && numberBox.right > visualBox.left
              && numberBox.top < visualBox.bottom
              && numberBox.bottom > visualBox.top;
          });
          expect(intersects, `scene ${index + 1} at ${width}px`).toBe(false);
        }
      });
    }
  });

  test('keeps the comparison title fully readable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/');

    const heading = page.getByRole('heading', { level: 4, name: 'Quote comparison' });
    await expect(heading).toBeVisible();
    const geometry = await heading.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      text: element.textContent,
      textOverflow: getComputedStyle(element).textOverflow,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    expect(geometry.text).toBe('Quote comparison');
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.textOverflow).not.toBe('ellipsis');
    expect(geometry.whiteSpace).not.toBe('nowrap');
  });

  test('gives every footer destination a 44px touch target', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/');

    const footerLinks = page.getByRole('contentinfo').getByRole('link');
    expect(await footerLinks.count()).toBeGreaterThan(0);
    for (const link of await footerLinks.all()) {
      const label = await link.textContent() ?? 'footer link';
      const box = await link.boundingBox();
      expect(box, label).not.toBeNull();
      expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
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
    const routeNodeMotion = await routeNodes.evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      const delay = style.animationDelay.split(',')[0].trim();
      const numericDelay = Number.parseFloat(delay);
      return {
        animationName: style.animationName,
        delayMs: delay.endsWith('ms') ? numericDelay : numericDelay * 1000,
      };
    }));
    for (const [index, motion] of routeNodeMotion.entries()) {
      expect(motion.animationName, `hero route card ${index + 1} animation`).toBe(
        'landing-hero-card-enter',
      );
      if (index > 0) {
        expect(motion.delayMs, `hero route card ${index + 1} delay`).toBeGreaterThan(
          routeNodeMotion[index - 1].delayMs,
        );
      }
    }
    for (const selector of landingMotionSelectors) {
      const motion = await page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          animationTimeline: style.getPropertyValue('animation-timeline'),
        };
      });
      expect(motion.animationName, `${selector} animation`).toBe('landing-diagram-enter');
      expect(motion.animationTimeline, `${selector} timeline`).toContain('view');
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();

    await expect(routeNodes).toHaveCount(4);
    for (const node of await routeNodes.all()) await expect(node).toBeVisible();
    expect(await connector.evaluate((element) => (
      getComputedStyle(element, '::after').animationName
    ))).toBe('none');
    const reducedRouteNodeMotion = await routeNodes.evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        animationName: style.animationName,
        opacity: style.opacity,
        transform: style.transform,
      };
    }));
    for (const [index, motion] of reducedRouteNodeMotion.entries()) {
      expect(motion, `hero route card ${index + 1} reduced-motion styles`).toEqual({
        animationName: 'none',
        opacity: '1',
        transform: 'none',
      });
    }
    for (const selector of landingMotionSelectors) {
      const motion = await page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          opacity: style.opacity,
          transform: style.transform,
        };
      });
      expect(motion, `${selector} reduced-motion styles`).toEqual({
        animationName: 'none',
        opacity: '1',
        transform: 'none',
      });
    }
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
  test('gives every guided product scene one measured desktop frame', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

    for (const size of firstFoldSizes) {
      await test.step(size.name, async () => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto('/product');

        const frames = page.locator('.tour-step, .product-principles');
        await expect(frames).toHaveCount(4);
        const measurements = await frames.evaluateAll((elements) => elements.map((element) => ({
          name: element.className,
          height: element.getBoundingClientRect().height,
          verticalOverflow: element.scrollHeight - element.clientHeight,
          horizontalOverflow: element.scrollWidth - element.clientWidth,
        })));
        for (const measurement of measurements) {
          expect(measurement.height, `${measurement.name} height`).toBeGreaterThanOrEqual(
            size.height - 2,
          );
          expect(measurement.verticalOverflow, `${measurement.name} vertical clipping`).toBeLessThanOrEqual(1);
          expect(measurement.horizontalOverflow, `${measurement.name} horizontal clipping`).toBeLessThanOrEqual(1);
        }

        const heroSize = await page.locator('.product-hero h1').evaluate((element) => (
          Number.parseFloat(getComputedStyle(element).fontSize)
        ));
        const stepSizes = await page.locator('.tour-step__copy h2').evaluateAll((headings) => (
          headings.map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize))
        ));
        const principlesSize = await page.locator('.product-principles h2').evaluate((element) => (
          Number.parseFloat(getComputedStyle(element).fontSize)
        ));
        for (const stepSize of stepSizes) expect(stepSize).toBeLessThanOrEqual(heroSize * 0.65);
        expect(principlesSize).toBeLessThanOrEqual(heroSize * 0.72);
        await expectNoPageOverflow(page);
      });
    }
  });

  test('keeps guided product scenes naturally sized on short desktops', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop viewport contract');

    await page.setViewportSize({ width: 1024, height: 650 });
    await page.goto('/product');
    const frames = page.locator('.tour-step, .product-principles');
    const minHeights = await frames.evaluateAll((elements) => (
      elements.map((element) => getComputedStyle(element).minHeight)
    ));

    expect(minHeights).not.toContain('650px');
    await expectNoPageOverflow(page);
  });

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
