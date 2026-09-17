// Test 7: a run — several instructions worked through as one checklist.
//
// This is the departure-checklist flow, and the thing it must never do is lose
// your place: the run has to survive walking away from it and closing the app,
// because that is exactly when you are interrupted. Finishing then has to record
// a completion for everything you ticked, and for nothing you didn't.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction } from './_app.js';

test.setTimeout(120_000);

test('a run keeps your place and marks only what you ticked', async ({ page }) => {
  await openApp(page);
  const a = String(400 + (Date.now() % 40));
  const b = String(Number(a) + 40);
  const nameA = `Run first ${Date.now()}`;
  const nameB = `Run second ${Date.now()}`;

  // Two instructions, both starred — Favourites is a set of exactly these two.
  for (const [number, name] of [[a, nameA], [b, nameB]]) {
    await writeInstruction(page, { number, name });
    await page.getByTestId('instruction-search').fill(number);
    await page.getByTestId('instruction-row').first().click();
    await expect(page.locator('body[data-screen="instructionScreen"]')).toBeAttached();
    await page.getByTestId('instruction-favourite').click();
    await expect(page.getByTestId('instruction-favourite')).toHaveAttribute('data-on', '1');
  }

  // Start the Favourites set.
  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('go-run').click();
  await expect(page.locator('body[data-screen="runPickerScreen"]')).toBeAttached();
  const favourites = page.locator('[data-testid="run-set"][data-set="favourites"]');
  await expect(favourites).toHaveAttribute('data-count', '2');
  await favourites.click();

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
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(a);
  await page.getByTestId('instruction-row').first().click();
  await expect(page.getByTestId('completion-count')).toContainText('1');

  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(b);
  await page.getByTestId('instruction-row').first().click();
  await expect(page.getByTestId('completion-count'), 'an unticked instruction is untouched')
    .toContainText('0');
});
