// Test 10: the step ticks — where you are in a job, right now.
//
// Four separate promises, and the last one is the interesting one. Ticks are
// stored as step POSITIONS, so if the steps are rewritten the old ticks would
// quietly point at the wrong lines — and a checklist that lies about which steps
// you have done is worse than one that forgot. The app keeps the step count
// alongside the ticks so it can spot that and drop them; this holds it to that.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, openInstruction, freeNumber } from './_app.js';

test.setTimeout(120_000);

test('step ticks stay put, clear on Done, and are dropped if the steps change', async ({ page }) => {
  await openApp(page);
  const number = freeNumber();
  const name = `Stepped job ${Date.now()}`;

  await writeInstruction(page, { number, name, steps: 'Open the valve\nDrain it\nClose the valve' });
  await openInstruction(page, number);

  // Nothing ticked: no progress line. "0 of 3 done" above every untouched job
  // would be a line of noise on every instruction in the app.
  await expect(page.getByTestId('step')).toHaveCount(3);
  await expect(page.getByTestId('step-progress')).toBeHidden();

  // Tick the middle one.
  await page.getByTestId('step').nth(1).getByTestId('step-tick').check();
  await expect(page.getByTestId('step').nth(1)).toHaveAttribute('data-done', '1');
  await expect(page.getByTestId('step-progress')).toBeVisible();
  await expect(page.getByTestId('step-progress')).toHaveAttribute('data-done', '1');
  await expect(page.getByTestId('step-progress')).toHaveAttribute('data-total', '3');

  // 1. It survives leaving the instruction and coming back.
  await openTab(page, 'home', 'homeScreen');
  await openInstruction(page, number);
  await expect(page.getByTestId('step').nth(1)).toHaveAttribute('data-done', '1');

  // 2. And closing the app — you get interrupted mid-job, that is the point.
  await restartApp(page);
  await openInstruction(page, number);
  await expect(page.getByTestId('step').nth(1)).toHaveAttribute('data-done', '1');
  await expect(page.getByTestId('step').nth(0)).toHaveAttribute('data-done', '0');

  // 3. Reset clears them.
  await page.getByTestId('step-reset').click();
  await expect(page.getByTestId('step-progress')).toBeHidden();
  await expect(page.getByTestId('step').nth(1)).toHaveAttribute('data-done', '0');

  // 4. Marking the job Done clears them too: the next run starts from a clean
  // list rather than one that looks already finished.
  await page.getByTestId('step').nth(0).getByTestId('step-tick').check();
  await page.getByTestId('step').nth(2).getByTestId('step-tick').check();
  await expect(page.getByTestId('step-progress')).toHaveAttribute('data-done', '2');
  await page.getByTestId('instruction-done').click();
  await page.getByTestId('choice-none').click();
  await expect(page.getByTestId('completion-count')).toContainText('1');
  await expect(page.getByTestId('step-progress'), 'Done wipes the ticks').toBeHidden();

  // 5. The one that matters: rewriting the steps drops stale ticks rather than
  // pointing them at whichever lines now sit in those positions.
  await page.getByTestId('step').nth(0).getByTestId('step-tick').check();
  await expect(page.getByTestId('step-progress')).toHaveAttribute('data-done', '1');
  await page.getByTestId('instruction-edit').click();
  await expect(page.locator('body[data-screen="editorScreen"]')).toBeAttached();
  await page.getByTestId('editor-steps').fill('Put on gloves\nOpen the valve\nDrain it\nClose the valve');
  await page.getByTestId('editor-save').click();
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();

  await openInstruction(page, number);
  await expect(page.getByTestId('step')).toHaveCount(4);
  await expect(page.getByTestId('step-progress'), 'a rewritten list starts clean').toBeHidden();
  for (const i of [0, 1, 2, 3]) {
    await expect(page.getByTestId('step').nth(i), `step ${i + 1} is not falsely ticked`)
      .toHaveAttribute('data-done', '0');
  }
});
