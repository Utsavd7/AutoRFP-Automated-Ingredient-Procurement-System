import { expect, test } from '@playwright/test';

const liveProviderConfigured = Boolean(
  process.env.AUTH_E2E_LIVE_GOOGLE === '1' &&
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET,
);

test.describe('Google provider live boundary', () => {
  test.skip(
    !liveProviderConfigured,
    'Requires explicit live Google OAuth credentials; local tests do not claim provider validation.',
  );

  test('configured Google action begins the real provider redirect', async ({ page }) => {
    await page.goto('/signin');
    const google = page.getByRole('button', { name: 'Continue with Google' });
    await expect(google).toBeEnabled();
    await google.click();
    await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
  });
});
