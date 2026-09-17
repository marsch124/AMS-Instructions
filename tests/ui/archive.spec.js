// Test 16: archiving — something you have retired must stop nagging you, and
// must still be there when you go looking for it.
//
// The nagging half is a silent failure in the other direction from most: the app
// would keep telling you a job is overdue for something you no longer own, and
// the only cure would be deleting it — which is exactly what Archived exists to
// avoid. The finding-it half matters just as much: an archive you cannot open
// again is a delete with extra steps.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, openInstruction, freeNumber, rows } from './_app.js';

test.setTimeout(120_000);

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-06-01T09:00:00Z');

const chip = (page, group, key) =>
  page.locator(`[data-testid="filter-chip"][data-group="${group}"][data-key="${key}"]`);

test('an archived instruction stops falling due, and can still be found', async ({ page }) => {
  page.on('dialog', (d) => d.dismiss());
  await page.clock.install({ time: START });
  await page.clock.resume();

  await openApp(page);
  const number = freeNumber();
  const name = `Retired thing ${Date.now()}`;

  // A daily job, done today, so its clock is running.
  await writeInstruction(page, { number, name, steps: 'Check it', frequency: 'Daily' });
  await openInstruction(page, number);
  await page.getByTestId('instruction-done').click();
  await page.getByTestId('choice-none').click();
  await expect(page.getByTestId('completion-count')).toContainText('1');

  // Two days on, it is nagging.
  await page.clock.setSystemTime(new Date(START.getTime() + 2 * DAY));
  await restartApp(page);
  await expect(page.getByTestId('due-nudge'), 'a daily job goes overdue').toBeVisible();

  // Retire it.
  await openInstruction(page, number);
  await page.getByTestId('instruction-edit').click();
  await expect(page.locator('body[data-screen="editorScreen"]')).toBeAttached();
  await page.getByTestId('editor-status').selectOption('Archived');
  await page.getByTestId('editor-save').click();
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();

  // The nagging stops — now, and on every start after.
  await openTab(page, 'home', 'homeScreen');
  await expect(page.getByTestId('due-nudge'), 'archived never falls due').toBeHidden();
  await restartApp(page);
  await expect(page.getByTestId('due-nudge'), 'and it stays stopped').toBeHidden();

  // But it is kept, and the Archived filter finds it — an archive you cannot
  // open again is a delete with extra steps.
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('filter-open').click();
  await expect(page.getByTestId('filter-panel')).toBeVisible();
  await expect(chip(page, 'status', 'Archived'), 'the chip counts it').toHaveAttribute('data-count', '1');
  await chip(page, 'status', 'Archived').click();
  await expect(rows(page, number)).toHaveCount(1);
  await expect(page.getByTestId('list-summary')).toHaveAttribute('data-shown', '1');

  // And it opens, and says what it is.
  await rows(page, number).click();
  await expect(page.locator('body[data-screen="instructionScreen"]')).toBeAttached();
  await expect(page.locator('#instructionScreen')).toContainText(name);

  // Bringing it back out of the archive starts the nagging again — the decision
  // is reversible, which is the whole reason for keeping it.
  await page.getByTestId('instruction-edit').click();
  await page.getByTestId('editor-status').selectOption('Active');
  await page.getByTestId('editor-save').click();
  await openTab(page, 'home', 'homeScreen');
  await expect(page.getByTestId('due-nudge'), 'un-archiving puts it back on the list').toBeVisible();
});
