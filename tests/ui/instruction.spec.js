// Test 2 of the suite: the core flow — write an instruction, find it again.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, freeNumber, rows } from './_app.js';

test('an instruction can be written, found and re-opened', async ({ page }) => {
  await openApp(page);
  const number = freeNumber();
  const name = `Test routine ${Date.now()}`;

  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-new').click();
  await expect(page.locator('body[data-screen="editorScreen"]')).toBeAttached();

  await page.getByTestId('editor-number').fill(number);
  await page.getByTestId('editor-name').fill(name);
  await page.getByTestId('editor-steps').fill('Open the cupboard\nTake the thing out\nPut it back');
  await page.getByTestId('editor-save').click();

  // Back on the list. Browsing shows folded folders per category, so the new one
  // is found the way a person finds it: by searching, which flattens the list.
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();
  await page.getByTestId('instruction-search').fill(number);
  const row = rows(page);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(name);
  await expect(row).toContainText(number);

  // Nonsense finds nothing, rather than everything.
  await page.getByTestId('instruction-search').fill('qqzzxx-nothing');
  await expect(rows(page)).toHaveCount(0);

  // It is a saved fact: still there after the app restarts.
  await restartApp(page);
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(number);
  await expect(rows(page).filter({ hasText: name })).toHaveCount(1);

  // And it opens — the row carrying THIS number, not whichever happens to be first.
  await rows(page, number).click();
  await expect(page.locator('body[data-screen="instructionScreen"]')).toBeAttached();
  await expect(page.locator('#instructionScreen')).toContainText(name);
});
