// Test 1 of the suite: the app starts, opens its database and names its version.
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

test('the app starts and shows its version', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e}`));

  await openApp(page);

  // 🪤 index.html carries a version in its markup, so merely seeing "v41.1" proves
  // nothing — the app could have failed to write it and the static text would sit
  // there looking right. Compare against what the code itself says instead, which
  // also catches the two version markers drifting apart.
  const code = await page.evaluate(() => APP_VERSION);
  expect(code, 'the code names a version').toMatch(/^\d+\.\d+/);
  await expect(page.getByTestId('app-version')).toHaveText(`v${code}`);
  await expect(page.locator('#versionNumber')).toHaveText(code);
  // All four tabs are there to be reached.
  for (const tab of ['home', 'instructions', 'actions', 'settings']) {
    await expect(page.getByTestId(`tab-${tab}`)).toBeVisible();
  }
  expect(errors, 'starting raised no error').toEqual([]);
});
