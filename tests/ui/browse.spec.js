// Test 17: finding things — the filters and the sort order.
//
// These two carry OPPOSITE decisions, written down in the app's own comments, and
// each would be easy to invert by accident:
//
//   · a sort order IS remembered between visits — it hides nothing, and re-picking
//     "most overdue first" every single time would be a daily annoyance;
//   · a filter is dropped every time you arrive at the Instructions tab — it hides
//     things, and being left on one silently is exactly how a library comes to
//     look as though it has lost data.
//
// The second is the dangerous one, so the test also holds the app to saying out
// loud when a filter is on.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, freeNumber, rows } from './_app.js';

test.setTimeout(120_000);

const chip = (page, group, key) =>
  page.locator(`[data-testid="filter-chip"][data-group="${group}"][data-key="${key}"]`);

const listedNumbers = (page) => rows(page).evaluateAll(
  (els) => els.map((el) => el.dataset.number));

// 🪤 Re-ordering the list is asynchronous — picking a sort saves it, closes the
// panel and THEN redraws. A plain expect() on the order reads whatever is on
// screen at that instant and does not retry, so it catches the old order. Poll.
const listedInOrder = (page, expected, message) =>
  expect.poll(() => listedNumbers(page), { message }).toEqual(expected);

test('the sort order is remembered and a filter is not', async ({ page }) => {
  page.on('dialog', (d) => d.dismiss());
  await openApp(page);

  // Three instructions whose number order is the exact reverse of their title
  // order, so the two sorts cannot be mistaken for each other.
  const tag = `Browse${Date.now()}`;
  const first = freeNumber(), second = freeNumber(), third = freeNumber();
  await writeInstruction(page, { number: first, name: `${tag} Zebra` });
  await writeInstruction(page, { number: second, name: `${tag} Mango` });
  await writeInstruction(page, { number: third, name: `${tag} Apple` });

  // Searching flattens the list, which is where an order is visible at all.
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(tag);
  await expect(rows(page)).toHaveCount(3);
  await listedInOrder(page, [first, second, third], 'by number to begin with');
  await expect(page.getByTestId('sort-open')).toHaveAttribute('data-sort', 'number');

  // Change the order.
  await page.getByTestId('sort-open').click();
  await expect(page.getByTestId('sort-panel')).toBeVisible();
  await page.locator('[data-testid="sort-option"][data-key="title"]').click();
  await listedInOrder(page, [third, second, first], 'now by title, which reverses them');
  await expect(page.getByTestId('sort-open')).toHaveAttribute('data-sort', 'title');

  // A sort order IS remembered — it hides nothing.
  await restartApp(page);
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(tag);
  await expect(page.getByTestId('sort-open'), 'the order survives a restart')
    .toHaveAttribute('data-sort', 'title');
  await listedInOrder(page, [third, second, first], 'and the order really is still by title');

  // Now a filter. Nothing here has ever been marked Done, so "Never done" is a
  // filter that genuinely hides things.
  await page.getByTestId('instruction-search').fill('');
  await page.getByTestId('filter-open').click();
  await chip(page, 'gaps', 'photo').click();
  await expect(chip(page, 'gaps', 'photo')).toHaveAttribute('data-on', '1');

  // The app has to SAY a filter is on, or a hidden library looks like a lost one.
  await expect(page.getByTestId('filter-count'), 'the count of filters on is shown').toBeVisible();
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await expect(page.getByTestId('filter-clear'), 'and a way out is offered').toBeVisible();

  // A filter is dropped the moment you LEAVE the tab and come back — a stronger
  // promise than merely forgetting it overnight, and the one the app actually
  // makes: arriving at Instructions always shows the whole library.
  await openTab(page, 'home', 'homeScreen');
  await openTab(page, 'instructions', 'instructionsListScreen');
  await expect(page.getByTestId('filter-count'), 'coming back to the tab drops the filter').toBeHidden();
  await page.getByTestId('filter-open').click();
  await expect(chip(page, 'gaps', 'photo')).toHaveAttribute('data-on', '0');

  // Nor does one survive a restart.
  await chip(page, 'gaps', 'photo').click();
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await restartApp(page);
  await openTab(page, 'instructions', 'instructionsListScreen');
  await expect(page.getByTestId('filter-count'), 'and none survives a restart').toBeHidden();

  // And Clear filters really does clear them, there and then.
  await page.getByTestId('filter-open').click();
  await chip(page, 'gaps', 'photo').click();
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await page.getByTestId('filter-clear').click();
  await expect(page.getByTestId('filter-count')).toBeHidden();
  await page.getByTestId('instruction-search').fill(tag);
  await expect(rows(page), 'the whole library is back').toHaveCount(3);
});
