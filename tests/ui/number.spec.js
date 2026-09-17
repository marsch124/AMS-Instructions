// Test 12: two instructions may not share a number — and you are TOLD so.
//
// The database has always refused it. Until v41.11 it refused silently: the write
// threw behind the scenes, nothing was saved, and Save appeared to do nothing at
// all. With 200-odd instructions in the library, reaching for a number already in
// use is an ordinary mistake, and losing what you typed to it is not acceptable.
import { test, expect } from '@playwright/test';
import { openApp, openTab, writeInstruction, freeNumber, rows } from './_app.js';

test.setTimeout(120_000);

test('a number already in use is refused out loud, and nothing is lost', async ({ page }) => {
  const shown = [];
  page.on('dialog', (d) => { shown.push(d.message()); d.dismiss(); });

  await openApp(page);
  const number = freeNumber();
  const first = `The first one ${Date.now()}`;
  await writeInstruction(page, { number, name: first });

  // Try to give a second instruction the same number.
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-new').click();
  await page.getByTestId('editor-number').fill(number);
  await page.getByTestId('editor-name').fill('The second one');
  await page.getByTestId('editor-steps').fill('Something else entirely');
  await page.getByTestId('editor-save').click();

  // It says so, and it says which instruction has that number.
  await expect.poll(() => shown.length, { message: 'saving a duplicate number says something' })
    .toBeGreaterThan(0);
  expect(shown.join(' '), 'it names the number and the instruction holding it').toContain(number);
  expect(shown.join(' ')).toContain(first);

  // It keeps you in the editor with your typing intact, rather than throwing it away.
  await expect(page.locator('body[data-screen="editorScreen"]')).toBeAttached();
  await expect(page.getByTestId('editor-name')).toHaveValue('The second one');
  await expect(page.getByTestId('editor-steps')).toHaveValue('Something else entirely');

  // And nothing was written: one instruction still owns that number.
  const free = freeNumber();
  await page.getByTestId('editor-number').fill(free);
  await page.getByTestId('editor-save').click();
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();

  await page.getByTestId('instruction-search').fill(number);
  const listed = rows(page);
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText(first);
});
