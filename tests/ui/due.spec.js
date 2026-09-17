// Test 9: due dates — the app's reminder brain.
//
// This is the one flow whose failure is SILENT. Everything else announces itself:
// a lost instruction is missing, a broken screen is blank. A due date that never
// comes round just means a safety check quietly never happens again, and there is
// nothing on screen to notice. So the test moves the clock forward instead of
// waiting a month, and holds the whole loop to account: not due → due → done →
// not due again.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, openInstruction } from './_app.js';

test.setTimeout(120_000);

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-06-01T09:00:00Z');

test('something done today falls due again, and marking it done clears it', async ({ page }) => {
  // A clock this test owns. Installed before the app loads, and left ticking
  // normally — a frozen clock would hang anything waiting on a timer.
  await page.clock.install({ time: START });
  await page.clock.resume();

  await openApp(page);
  const number = String(200 + (Date.now() % 40));
  const name = `Daily check ${Date.now()}`;

  // An instruction with a clock: Daily.
  await writeInstruction(page, { number, name, steps: 'Check the thing', frequency: 'Daily' });

  // Never done = no clock started = NOT due. The starter library is 200-odd
  // instructions with frequencies and no completions; treating those as overdue
  // would bury Home on day one.
  await openTab(page, 'home', 'homeScreen');
  await expect(page.getByTestId('due-nudge'), 'a never-done instruction is not overdue').toBeHidden();

  // Mark it Done: the clock starts now.
  await openInstruction(page, number);
  await page.getByTestId('instruction-done').click();
  await expect(page.getByTestId('choice-modal')).toBeVisible();
  await page.getByTestId('choice-none').click();
  // 🪤 And wait for the completion to be WRITTEN before touching the clock: a
  // reload while that write is in flight throws it away, and the test then fails
  // for a reason that has nothing to do with due dates.
  await expect(page.getByTestId('completion-count')).toContainText('1');

  // Same day: done is done, nothing is due.
  await openTab(page, 'home', 'homeScreen');
  await expect(page.getByTestId('due-nudge'), 'done today is not due today').toBeHidden();

  // Two days later.
  await page.clock.setSystemTime(new Date(START.getTime() + 2 * DAY));
  await restartApp(page);
  await expect(page.getByTestId('due-nudge'), 'a daily job is due two days later').toBeVisible();

  // And it says which one.
  await page.getByTestId('due-nudge').click();
  await expect(page.locator('body[data-screen="dueScreen"]')).toBeAttached();
  await expect(page.getByTestId('due-list').locator(`[data-testid="instruction-row"][data-number="${number}"]`))
    .toHaveCount(1);

  // Doing it again closes the loop — the whole point of a reminder.
  await page.getByTestId('due-list').locator(`[data-testid="instruction-row"][data-number="${number}"]`)
    .first().click();
  await expect(page.locator('body[data-screen="instructionScreen"]')).toBeAttached();
  await page.getByTestId('instruction-done').click();
  // It asks again: "don't record a name" is not a name, so there is nobody to
  // remember (unlike the who-did-it test, where a person is picked and kept).
  await expect(page.getByTestId('choice-modal')).toBeVisible();
  await page.getByTestId('choice-none').click();
  await expect(page.getByTestId('completion-count')).toContainText('2');

  await openTab(page, 'home', 'homeScreen');
  await expect(page.getByTestId('due-nudge'), 'doing it again clears it').toBeHidden();
});
