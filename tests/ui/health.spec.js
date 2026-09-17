// Test 18: Library health — the screen that tells you what needs attention.
//
// Its failure mode is being BELIEVED. A health screen that says "nothing to tidy
// up" while instructions sit there with no owner is worse than no screen at all,
// because you stop checking by hand. So the test plants exactly the problems it
// claims to find, counts them, fixes one FROM that screen, and insists the count
// comes down — a list of problems with a fix button that does not fix anything
// would be the same lie wearing a different hat.
import { test, expect } from '@playwright/test';
import { openApp, openTab, writeInstruction, freeNumber, addPerson, rows } from './_app.js';

test.setTimeout(120_000);

const group = (page, key) => page.locator(`[data-testid="health-group"][data-key="${key}"]`);

test('Library health finds the gaps, counts them, and can fix one', async ({ page }) => {
  page.on('dialog', (d) => d.dismiss());
  await openApp(page);

  const who = `Owner ${Date.now()}`;
  const a = freeNumber();
  const b = freeNumber();

  await addPerson(page, who);
  // Two instructions with nobody's name on them, no warning, and a frequency —
  // so they are "no owner", "unfinished" and "never done" all at once.
  await writeInstruction(page, { number: a, name: `Unowned one ${Date.now()}`, frequency: 'Monthly' });
  await writeInstruction(page, { number: b, name: `Unowned two ${Date.now()}`, frequency: 'Monthly' });

  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('go-health').click();
  await expect(page.locator('body[data-screen="healthScreen"]')).toBeAttached();

  // It finds them, and says how many.
  await expect(group(page, 'noowner'), 'two instructions have no owner').toHaveAttribute('data-count', '2');
  await expect(group(page, 'never'), 'neither has ever been marked Done').toHaveAttribute('data-count', '2');
  await expect(group(page, 'unfinished')).toHaveAttribute('data-count', '2');

  // And names them, rather than only counting.
  await group(page, 'noowner').getByTestId('health-toggle').click();
  await expect(group(page, 'noowner').locator(`[data-testid="instruction-row"][data-number="${a}"]`))
    .toHaveCount(1);

  // Now fix it from here: give both an owner in one go.
  await page.getByTestId('health-owner-pick').selectOption({ label: who });
  await page.getByTestId('health-owner-apply').click();
  await expect(page.getByTestId('confirm-modal')).toBeVisible();
  await page.getByTestId('confirm-yes').click();

  // The count must come down, or the fix button is a lie.
  await expect(group(page, 'noowner'), 'the gap it just fixed is gone').toHaveAttribute('data-count', '0');
  // ...and only that gap: the others are untouched by naming an owner.
  await expect(group(page, 'never'), 'naming an owner does not mark anything Done')
    .toHaveAttribute('data-count', '2');

  // It really was written to the instructions, not just to the screen.
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(a);
  await expect(rows(page, a)).toContainText(who);
});
