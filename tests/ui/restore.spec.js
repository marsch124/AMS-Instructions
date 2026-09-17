// Test 13: the restore — the one path you only ever use after losing something.
//
// The backup test (4) proves the FILE is good. This proves the other half: that
// the file can actually be put back into the app. That half has never been tested
// here, and it is the half you need on the worst day. It also holds the app to
// the promise it makes in the question it asks — Cancel must change nothing.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, openInstruction, freeNumber, rows } from './_app.js';

test.setTimeout(120_000);

test('a backup file can be put back, and Cancel puts nothing back', async ({ page }, testInfo) => {
  const said = [];
  page.on('dialog', (d) => { said.push(d.message()); d.dismiss(); });

  await openApp(page);
  const number = freeNumber();
  const name = `Precious job ${Date.now()}`;
  const steps = 'Shut the water off\nUndo the collar\nLift it out';

  await writeInstruction(page, { number, name, steps });

  // A backup file, taken the way he takes one.
  await openTab(page, 'settings', 'settingsScreen');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('backup-export-settings').click(),
  ]);
  const file = testInfo.outputPath('restore-me.json');
  await download.saveAs(file);

  // Now lose it.
  await openInstruction(page, number);
  await page.getByTestId('instruction-edit').click();
  await expect(page.locator('body[data-screen="editorScreen"]')).toBeAttached();
  await page.getByTestId('instruction-delete').click();
  await expect(page.getByTestId('confirm-modal')).toBeVisible();
  await page.getByTestId('confirm-yes').click();
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();

  await page.getByTestId('instruction-search').fill(number);
  await expect(rows(page, number), 'it really is gone').toHaveCount(0);

  // Offer the file — and say no. Nothing may come back.
  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('restore-file-input').setInputFiles(file);
  await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('confirm-message'), 'it says what it is about to put back')
    .toContainText('1 instruction');
  await page.getByTestId('confirm-no').click();
  await expect(page.getByTestId('confirm-modal')).toBeHidden();

  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(number);
  await expect(rows(page, number), 'Cancel restores nothing').toHaveCount(0);

  // Now say yes.
  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('restore-file-input').setInputFiles(file);
  await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('confirm-yes').click();

  // It is back, whole — not just its name.
  await openInstruction(page, number);
  await expect(page.locator('#instructionScreen')).toContainText(name);
  await expect(page.getByTestId('step')).toHaveCount(3);
  await expect(page.getByTestId('steps')).toContainText('Undo the collar');

  // And it stayed back.
  await restartApp(page);
  await openInstruction(page, number);
  await expect(page.locator('#instructionScreen')).toContainText(name);
});
