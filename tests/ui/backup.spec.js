// Test 4: the safety net — a backup that really holds your work, and proves it.
//
// This app's backup doesn't just count what it holds: it puts it back, into a
// scratch copy of the app thrown away straight afterwards. This test holds it to
// that claim, and to the plainer one underneath — that the file it hands you is
// not empty. A blind backup once wrote an empty snapshot over good data, so the
// assertion that matters most here is "the instruction I just wrote is inside".
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, openTab, writeInstruction } from './_app.js';

test.setTimeout(120_000);

test('a backup holds the work, and proves it by restoring', async ({ page }, testInfo) => {
  await openApp(page);

  const number = String(600 + (Date.now() % 90));
  const name = `Backup witness ${Date.now()}`;
  await writeInstruction(page, { number, name });

  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('go-datasafety').click();
  await expect(page.locator('body[data-screen="dataSafetyScreen"]')).toBeAttached();

  // 1. The app's own check, on its own backups: each one is restored into a
  // scratch copy. The verdict is read from the card's state, never its wording —
  // 'bad' means it could not be read or could not be put back.
  await page.getByTestId('backup-check').click();
  const cards = page.getByTestId('check-card');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  await expect(cards.first(), 'the newest backup restores').toHaveAttribute('data-state', /^(ok|warn)$/);

  // 2. A backup that restores perfectly can still be missing this morning's work.
  // Nothing in the app may be absent from it.
  await expect(page.getByTestId('check-summary'), 'the backup is not behind the app')
    .toHaveAttribute('data-behind', '0');

  // 3. The file it hands you is a real backup with the instruction in it.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('backup-export').click(),
  ]);
  const file = testInfo.outputPath('backup.json');
  await download.saveAs(file);
  const raw = await readFile(file, 'utf8');
  expect(raw.length, 'the backup file is not empty').toBeGreaterThan(200);
  expect(raw, 'the backup holds the instruction just written').toContain(name);
  expect(() => JSON.parse(raw), 'the backup file is readable JSON').not.toThrow();

  // 4. And that very file passes the app's own test-restore.
  await page.getByTestId('backup-file-input').setInputFiles(file);
  await expect(cards, 'the file is checked on its own').toHaveCount(1, { timeout: 30_000 });
  await expect(cards, 'the exported file restores').toHaveAttribute('data-state', /^(ok|warn)$/);
});
