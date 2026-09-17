// Test 14: a deliberate wipe stays wiped — and an accidental one is still rescued.
//
// 🐛 Found by these tests, fixed in v41.12. Two safety features cancelled each
// other out: "Clear All Data" rolls the old backup into the previous slot so it
// stays undoable BY HAND from Data Safety, and the automatic rescue — the one
// that exists because a blind backup once wiped real data — found that slot on
// the next start and put everything back UNASKED. Deleting your last instruction
// did the same. An undo you did not ask for is not an undo; it is the app
// refusing to do as it is told.
//
// Both halves are tested here, because fixing the first by breaking the second
// would be much worse than the bug.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, openInstruction, freeNumber, rows } from './_app.js';

test.setTimeout(120_000);

const held = (page) => page.evaluate(async () => (await getAllInstructions()).length);

test('deleting the last instruction keeps it deleted', async ({ page }) => {
  page.on('dialog', (d) => d.dismiss());

  // The app says out loud when its rescue runs. Listening for that is the only
  // way to know the check actually HAPPENED — a plain wait only hopes it did,
  // and a rescue that never runs would pass a test that just waits.
  const checks = [];
  page.on('console', (m) => { if (m.text().includes('[Integrity]')) checks.push(m.text()); });

  await openApp(page);
  const number = freeNumber();
  await writeInstruction(page, { number, name: 'The only one', steps: 'A\nB' });

  await openInstruction(page, number);
  await page.getByTestId('instruction-edit').click();
  await page.getByTestId('instruction-delete').click();
  await expect(page.getByTestId('confirm-modal')).toBeVisible();
  await page.getByTestId('confirm-yes').click();
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();
  await expect.poll(() => held(page), { message: 'it is gone' }).toBe(0);

  // 🪤 Sit still past the second-chance check, which runs a second after the app
  // loads. On a slower machine that timer lands AFTER the delete rather than
  // before it — which is how CI caught a first version of this fix that marked
  // the deliberate wipe only once the delete had finished.
  await expect.poll(() => checks.length, { message: 'the rescue check really ran' }).toBeGreaterThan(0);
  expect(await held(page), 'it stays deleted while the app is still open').toBe(0);

  // And it must not come back by itself on the next start either.
  checks.length = 0;
  await restartApp(page);
  await expect.poll(() => checks.length, { message: 'the rescue check runs again on start-up' })
    .toBeGreaterThan(0);
  expect(await held(page), 'it stays deleted').toBe(0);

  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(number);
  await expect(rows(page, number)).toHaveCount(0);
});

test('an accidental wipe is still put back', async ({ page }) => {
  page.on('dialog', (d) => d.dismiss());
  await openApp(page);
  const number = freeNumber();
  const name = `Rescue me ${Date.now()}`;
  await writeInstruction(page, { number, name, steps: 'A\nB' });
  await expect.poll(() => held(page)).toBe(1);

  // Something empties the database WITHOUT the app being told to — the shape of
  // the failure that cost real data in 2026: a wipe nobody asked for.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('instructions', 'readwrite');
      tx.objectStore('instructions').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  });
  expect(await held(page), 'the database really is empty').toBe(0);

  // On the next start the app notices and puts it back, unasked — as it should.
  await restartApp(page);
  await expect.poll(() => held(page), { message: 'an unexplained empty app is rescued' }).toBe(1);
  await openInstruction(page, number);
  await expect(page.locator('#instructionScreen')).toContainText(name);
});
