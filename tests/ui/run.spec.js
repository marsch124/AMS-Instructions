// Test 7: a run — several instructions worked through as one checklist.
//
// This is the departure-checklist flow, and the thing it must never do is lose
// your place: the run has to survive walking away from it and closing the app,
// because that is exactly when you are interrupted. Finishing then has to record
// a completion for everything you ticked, and for nothing you didn't.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, freeNumber, openInstruction } from './_app.js';

test.setTimeout(120_000);

test('a run keeps your place and marks only what you ticked', async ({ page }) => {
  await openApp(page);
  const a = freeNumber();
  const b = freeNumber();
  const nameA = `Run first ${Date.now()}`;
  const nameB = `Run second ${Date.now()}`;

  // Two instructions. A fresh app holds nothing else, so the General category is
  // a set of exactly these two.
  //
  // 🪤 This used to star them and run the Favourites set — which put the star
  // between the test and its subject. It went red in CI on nothing to do with
  // runs. A test about runs picks the set that needs no other feature to work.
  for (const [number, name] of [[a, nameA], [b, nameB]]) {
    await writeInstruction(page, { number, name });
  }

  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('go-run').click();
  await expect(page.locator('body[data-screen="runPickerScreen"]')).toBeAttached();
  const set = page.locator('[data-testid="run-set"][data-set="category:General"]');
  await expect(set).toHaveAttribute('data-count', '2');
  await set.click();

  // Two rows, nothing done, and nothing to finish yet.
  await expect(page.locator('body[data-screen="runScreen"]')).toBeAttached();
  await expect(page.getByTestId('run-progress')).toHaveAttribute('data-total', '2');
  await expect(page.getByTestId('run-progress')).toHaveAttribute('data-ticked', '0');
  await expect(page.getByTestId('run-row')).toHaveCount(2);
  await expect(page.getByTestId('run-finish'), 'nothing ticked, nothing to finish').toBeDisabled();

  // Tick the first one only.
  const rowA = page.locator(`[data-testid="run-row"][data-number="${a}"]`);
  await rowA.getByTestId('run-tick').click();
  await expect(rowA).toHaveAttribute('data-done', '1');
  await expect(page.locator(`[data-testid="run-row"][data-number="${b}"]`)).toHaveAttribute('data-done', '0');
  await expect(page.getByTestId('run-progress')).toHaveAttribute('data-ticked', '1');
  await expect(page.getByTestId('run-finish')).toBeEnabled();

  // Walking away does not end a run: Home offers it back.
  await page.locator('.screen.active [data-testid="back"]').click();
  await expect(page.locator('body[data-screen="homeScreen"]')).toBeAttached();
  await expect(page.getByTestId('run-nudge'), 'Home offers the unfinished run back').toBeVisible();

  // Nor does closing the app. Your place is a saved fact.
  await restartApp(page);
  await expect(page.getByTestId('run-nudge')).toBeVisible();
  await page.getByTestId('run-nudge').click();
  await expect(page.locator('body[data-screen="runScreen"]')).toBeAttached();
  await expect(page.getByTestId('run-progress'), 'the tick survived the restart')
    .toHaveAttribute('data-ticked', '1');

  // Finish: asked once for the whole run, not once per instruction.
  await page.getByTestId('run-finish').click();
  await expect(page.getByTestId('choice-modal')).toBeVisible();
  await page.getByTestId('choice-none').click();
  await expect(page.locator('body[data-screen="homeScreen"]')).toBeAttached();
  await expect(page.getByTestId('run-nudge'), 'the run is over').toBeHidden();

  // The ticked one is Done once; the untouched one was left alone.
  await openInstruction(page, a);
  await expect(page.getByTestId('completion-count')).toContainText('1');

  await openInstruction(page, b);
  await expect(page.getByTestId('completion-count'), 'an unticked instruction is untouched')
    .toContainText('0');
});
