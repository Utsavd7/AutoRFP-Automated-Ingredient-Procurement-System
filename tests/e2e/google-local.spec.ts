import { expect, test, type Page } from '@playwright/test';

const localAuthOrigin = 'http://127.0.0.1:52562';

async function routeLocalNextAuth(page: Page) {
  await page.route('**/api/auth/**', async (route) => {
    const source = new URL(route.request().url());
    if (source.pathname === '/api/auth/start') {
      await route.continue();
      return;
    }
    const target = new URL(`${source.pathname}${source.search}`, localAuthOrigin);
    const headers = { ...route.request().headers() };
    delete headers.host;
    const response = await route.fetch({
      url: target.toString(),
      headers,
      maxRedirects: 0,
    });
    await route.fulfill({ response });
  });
}

test.beforeEach(async ({ page }) => {
  await routeLocalNextAuth(page);
});

function testIdentity(projectName: string, label: string) {
  const project = projectName.replace(/[^a-z0-9]+/gi, '-');
  return {
    email: `${label}-${project}@example.com`,
    subject: `${label}-${project}-subject`,
  };
}

async function fillWorkspace(page: Page, email: string) {
  await page.getByLabel('Restaurant name').fill('Coriander House Test Kitchen');
  await page.getByLabel('Street address').fill('44 Church Street');
  await page.getByLabel('City').fill('Bengaluru');
  await page.getByLabel('State').fill('Karnataka');
  await page.getByLabel('PIN code').fill('560001');
  await page.getByLabel('Restaurant phone').fill('+91 99887 76655');
  await page.getByLabel('Your name').fill('Mira Shah');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel(/^Password/).fill('Local-only test password 42!');
}

async function authorizeLocalGoogle(
  page: Page,
  identity: { email: string; subject: string },
) {
  await expect(page.getByRole('heading', { name: 'Local OAuth provider' })).toBeVisible();
  await page.getByLabel('Provider email').fill(identity.email);
  await page.getByLabel('Provider subject').fill(identity.subject);
  await page.getByLabel('Verified email').check();
  await page.getByRole('button', { name: 'Authorize' }).click();
}

async function startGoogle(page: Page) {
  await page.waitForLoadState('networkidle');
  const button = page.getByRole('button', { name: 'Continue with Google' });
  await expect.poll(() => button.evaluate((element) => {
    const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
    return Boolean(
      propsKey &&
      typeof (element as unknown as Record<string, { onClick?: unknown }>)[propsKey]?.onClick === 'function',
    );
  })).toBe(true);
  await button.click();
}

async function openAccountNavigation(page: Page) {
  if ((page.viewportSize()?.width ?? 1_440) < 1_024) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(
      page
        .getByRole('complementary')
        .getByRole('button', { name: 'Close navigation' }),
    ).toBeVisible();
  }
}

async function signOut(page: Page) {
  await openAccountNavigation(page);
  await page.locator('button:visible').filter({ hasText: /^Sign out$/ }).first().click();
  await expect(page).toHaveURL(/\/signin$/);
}

async function createEmailAccount(page: Page, email: string) {
  const response = await page.request.post('/api/auth/start', {
    data: {
      method: 'email',
      restaurantName: 'Coriander House Test Kitchen',
      ownerName: 'Mira Shah',
      email,
      password: 'Local-only test password 42!',
      addressLine: '44 Church Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin: '560001',
      phone: '+91 99887 76655',
      timezone: 'Asia/Kolkata',
      gstin: '',
    },
  });
  expect(response.status()).toBe(201);
}

test.describe.serial('application Google identity through local OAuth', () => {
  test('creates a verified Google workspace and returns through the same identity', async ({
    page,
  }, testInfo) => {
    const identity = testIdentity(testInfo.project.name, 'google-owner');
    await page.goto('/start?callbackUrl=%2Fsettings%3Fsection%3Dmembers');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await fillWorkspace(page, identity.email);
    expect(
      await page.locator('input:invalid').evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).name),
      ),
    ).toEqual([]);
    await startGoogle(page);
    await authorizeLocalGoogle(page, identity);

    await expect(page).toHaveURL(/\/settings\?section=members$/);
    await expect(page.getByRole('heading', { name: 'Restaurant settings' })).toBeVisible();
    await signOut(page);

    await page.goto('/signin?callbackUrl=%2Fsettings%3Fsection%3Dmembers');
    await startGoogle(page);
    await authorizeLocalGoogle(page, identity);
    await expect(page).toHaveURL(/\/settings\?section=members$/);
    await expect(page.getByRole('heading', { name: 'Restaurant settings' })).toBeVisible();
    await signOut(page);
  });

  test('does not attach a new Google identity to an existing email account', async ({
    page,
  }, testInfo) => {
    const identity = testIdentity(testInfo.project.name, 'collision');
    await createEmailAccount(page, identity.email);

    await page.goto('/start');
    await fillWorkspace(page, identity.email);
    await startGoogle(page);
    await authorizeLocalGoogle(page, identity);
    await expect(
      page.getByRole('alert').filter({ hasText: /already has an account/i }),
    ).toBeVisible();

    await page.goto('/signin');
    await startGoogle(page);
    await authorizeLocalGoogle(page, identity);
    await expect(
      page.getByRole('alert').filter({ hasText: /no workspace is connected/i }),
    ).toBeVisible();
  });

  test('does not turn an abandoned Google signup into a later Google sign-in', async ({
    page,
  }, testInfo) => {
    const identity = testIdentity(testInfo.project.name, 'abandoned-signup');
    await page.goto('/start');
    await fillWorkspace(page, identity.email);
    await startGoogle(page);
    await expect(page.getByRole('heading', { name: 'Local OAuth provider' })).toBeVisible();

    await page.goto('/signin');
    await startGoogle(page);
    await authorizeLocalGoogle(page, identity);

    await expect(
      page.getByRole('alert').filter({ hasText: /no workspace is connected/i }),
    ).toBeVisible();
  });

  test('keeps concurrent signup and sign-in tabs fail-safe when callbacks arrive out of order', async ({
    context,
    page: signupPage,
  }, testInfo) => {
    const identity = testIdentity(testInfo.project.name, 'concurrent-flow');
    await signupPage.goto('/start');
    await fillWorkspace(signupPage, identity.email);
    await startGoogle(signupPage);
    await expect(
      signupPage.getByRole('heading', { name: 'Local OAuth provider' }),
    ).toBeVisible();

    const signinPage = await context.newPage();
    await routeLocalNextAuth(signinPage);
    await signinPage.goto('/signin');
    await startGoogle(signinPage);
    await authorizeLocalGoogle(signinPage, identity);
    await expect(
      signinPage.getByRole('alert').filter({ hasText: /no workspace is connected/i }),
    ).toBeVisible();

    await authorizeLocalGoogle(signupPage, identity);
    await expect(
      signupPage.getByRole('alert').filter({
        hasText: /google sign-in is temporarily unavailable/i,
      }),
    ).toBeVisible();
  });

  test('surfaces safe provider and real database lookup failures', async ({
    page,
  }, testInfo) => {
    await page.goto('/signin');
    await startGoogle(page);
    await expect(page.getByRole('heading', { name: 'Local OAuth provider' })).toBeVisible();
    await page.getByRole('button', { name: 'Return provider error' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /google sign-in is temporarily unavailable/i }),
    ).toBeVisible();

    const identity = testIdentity(testInfo.project.name, 'database-failure');
    const denied = await page.request.post(`${localAuthOrigin}/__test/database/identity-lookup`, {
      data: { available: false },
    });
    expect(denied.status()).toBe(204);
    try {
      await page.goto('/signin');
      await startGoogle(page);
      await authorizeLocalGoogle(page, identity);
      await expect(
        page.getByRole('alert').filter({
          hasText: 'Google sign-in is temporarily unavailable. Try again shortly.',
        }),
      ).toHaveText('Google sign-in is temporarily unavailable. Try again shortly.');
    } finally {
      const restored = await page.request.post(`${localAuthOrigin}/__test/database/identity-lookup`, {
        data: { available: true },
      });
      expect(restored.status()).toBe(204);
    }
  });
});
