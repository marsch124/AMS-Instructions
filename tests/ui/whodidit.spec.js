// Test 6: the "who did it" log — the app's whole point on a shared job.
//
// Marking something Done has to survive a restart, and the name has to survive
// with it. The second half tests the promise the app makes out loud: it asks who
// once and remembers, so the fifth time is still one tap.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction } from './_app.js';

test.setTimeout(120_000);

test('marking done records who did it, and remembers them next time', async ({ page }) => {
  await openApp(page);
  const who = `Tester ${Date.now()}`;
  const number = String(500 + (Date.now() % 90));
  const name = `Shared job ${Date.now()}`;

  // Somebody to credit.
  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('person-new').click();
  await expect(page.locator('body[data-screen="personEditorScreen"]')).toBeAttached();
  await page.getByTestId('person-name').fill(who);
  await page.getByTestId('person-save').click();
  await expect(page.locator('body[data-screen="personEditorScreen"]')).not.toBeAttached();

  // Something to do.
  await writeInstruction(page, { number, name });
  await page.getByTestId('instruction-search').fill(number);
  await page.getByTestId('instruction-row').first().click();
  await expect(page.locator('body[data-screen="instructionScreen"]')).toBeAttached();

  // Mark Done: it asks who, the first time.
  await page.getByTestId('instruction-done').click();
  await expect(page.getByTestId('choice-modal')).toBeVisible();
  await page.getByTestId('choice-option').filter({ hasText: who }).click();
  await expect(page.getByTestId('choice-modal')).toBeHidden();

  // The name is on the job, and the counter moved.
  await expect(page.getByTestId('last-completed')).toContainText(who);
  await expect(page.getByTestId('completion-count')).toContainText('1');
  await page.getByTestId('fold-done-log').click();
  const entries = page.getByTestId('done-log').getByTestId('done-entry');
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText(who);

  // It is written down, not merely displayed.
  await restartApp(page);
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(number);
  await page.getByTestId('instruction-row').first().click();
  await page.getByTestId('fold-done-log').click();
  await expect(page.getByTestId('done-log').getByTestId('done-entry')).toHaveCount(1);
  await expect(page.getByTestId('done-log').getByTestId('done-entry').first()).toContainText(who);

  // And the promise: asked once, remembered after. The second Done is one tap,
  // with no question, and it still lands under the same name.
  await page.getByTestId('instruction-done').click();
  await expect(page.getByTestId('choice-modal'), 'it does not ask twice').toBeHidden();
  const both = page.getByTestId('done-log').getByTestId('done-entry');
  await expect(both).toHaveCount(2);
  await expect(both.nth(0)).toContainText(who);
  await expect(both.nth(1)).toContainText(who);
  await expect(page.getByTestId('completion-count')).toContainText('2');
});
