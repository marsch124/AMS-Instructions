// Test 11: the ★ — the shortcut to the handful of instructions you actually use.
//
// Its own test rather than a step inside another one. The run test used to lean
// on starring to build its set, and when that went red in CI it looked like runs
// were broken. One test, one subject: if a star fails to stick, this is what says
// so, and the run test keeps testing runs.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, openInstruction, freeNumber } from './_app.js';

test.setTimeout(120_000);

test('starring an instruction puts it on Home, and unstarring takes it off', async ({ page }) => {
  await openApp(page);
  const number = freeNumber();
  const name = `Starred job ${Date.now()}`;

  await writeInstruction(page, { number, name });

  // Nothing starred yet.
  await openTab(page, 'home', 'homeScreen');
  await expect(page.getByTestId('favourites-list').getByTestId('instruction-card')).toHaveCount(0);

  // Star it.
  await openInstruction(page, number);
  await expect(page.getByTestId('instruction-favourite')).toHaveAttribute('data-on', '0');
  await page.getByTestId('instruction-favourite').click();
  await expect(page.getByTestId('instruction-favourite')).toHaveAttribute('data-on', '1');

  // It is on Home straight away.
  await openTab(page, 'home', 'homeScreen');
  const card = page.getByTestId('favourites-list').getByTestId('instruction-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(name);

  // And it is a saved fact, not a screen state.
  await restartApp(page);
  await expect(page.getByTestId('favourites-list').getByTestId('instruction-card')).toHaveCount(1);
  await openInstruction(page, number);
  await expect(page.getByTestId('instruction-favourite'), 'the star is still on after a restart')
    .toHaveAttribute('data-on', '1');

  // The same tap takes it off again.
  await page.getByTestId('instruction-favourite').click();
  await expect(page.getByTestId('instruction-favourite')).toHaveAttribute('data-on', '0');
  await openTab(page, 'home', 'homeScreen');
  await expect(page.getByTestId('favourites-list').getByTestId('instruction-card')).toHaveCount(0);

  // Including after a restart — an unstar that quietly came back would be worse
  // than one that never happened.
  await restartApp(page);
  await expect(page.getByTestId('favourites-list').getByTestId('instruction-card')).toHaveCount(0);
});
