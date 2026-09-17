// Test 5: the to-dos — written, listed, ticked off, and still ticked tomorrow.
//
// Ticking something off is the one gesture in this app that is meant to be one
// tap and never a mistake, so the test also unticks it again.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp } from './_app.js';

test.setTimeout(120_000);

test('a to-do can be written, ticked off and re-opened', async ({ page }) => {
  await openApp(page);
  const title = `Replace the filter ${Date.now()}`;

  await openTab(page, 'actions', 'actionsScreen');
  await page.getByTestId('action-new').click();
  await expect(page.locator('body[data-screen="actionEditorScreen"]')).toBeAttached();

  await page.getByTestId('action-title').fill(title);
  await page.getByTestId('action-notes').fill('The one behind the panel');
  await page.getByTestId('action-priority').selectOption('high');
  await page.getByTestId('action-due').fill('2026-12-01');
  await page.getByTestId('action-save').click();

  // It lands in the open list, not done.
  await expect(page.locator('body[data-screen="actionsScreen"]')).toBeAttached();
  const mine = page.getByTestId('action-row').filter({ hasText: title });
  await expect(mine).toHaveCount(1);
  await expect(mine).toHaveAttribute('data-done', '0');
  await expect(page.getByTestId('open-actions').getByTestId('action-row').filter({ hasText: title })).toHaveCount(1);

  // One tap ticks it off: it leaves the open list and joins the Done fold.
  await mine.getByTestId('action-tick').click();
  await expect(page.getByTestId('open-actions').getByTestId('action-row').filter({ hasText: title })).toHaveCount(0);
  await page.getByTestId('fold-done-actions').click();
  const done = page.getByTestId('done-actions').getByTestId('action-row').filter({ hasText: title });
  await expect(done).toHaveCount(1);
  await expect(done).toHaveAttribute('data-done', '1');

  // Done is a saved fact, not a screen state.
  await restartApp(page);
  await openTab(page, 'actions', 'actionsScreen');
  await expect(page.getByTestId('open-actions').getByTestId('action-row').filter({ hasText: title })).toHaveCount(0);
  await page.getByTestId('fold-done-actions').click();
  const again = page.getByTestId('done-actions').getByTestId('action-row').filter({ hasText: title });
  await expect(again).toHaveCount(1);

  // And a tick is never a trap: the same tap puts it back.
  await again.getByTestId('action-tick').click();
  await expect(page.getByTestId('open-actions').getByTestId('action-row').filter({ hasText: title }))
    .toHaveAttribute('data-done', '0');
});
