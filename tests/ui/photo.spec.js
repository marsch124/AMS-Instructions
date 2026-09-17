// Test 8: a photo on an instruction — kept, shown, and SHRUNK on the way in.
//
// A phone photo is several megabytes. If the app stored what the camera handed
// it, a couple of dozen instructions would fill the phone's allowance and the
// backup with it — and that failure shows up as data loss weeks later, not as
// anything you would notice adding a picture. So the test feeds it a deliberately
// oversized image and holds it to what it actually stored.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp } from './_app.js';
import { makePng } from './_png.js';

test.setTimeout(120_000);

const PHOTO_MAX_EDGE = 1400;   // the app's own limit, in js/ui.js

test('a photo is kept with the instruction, and shrunk on the way in', async ({ page }) => {
  await openApp(page);
  const number = String(300 + (Date.now() % 40));
  const name = `Photo job ${Date.now()}`;
  const big = makePng(2400, 1600);

  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-new').click();
  await expect(page.locator('body[data-screen="editorScreen"]')).toBeAttached();
  await page.getByTestId('editor-number').fill(number);
  await page.getByTestId('editor-name').fill(name);
  await page.getByTestId('editor-steps').fill('Look at the picture\nDo the thing');

  await page.getByTestId('photo-input').setInputFiles({
    name: 'valve.png', mimeType: 'image/png', buffer: big,
  });

  // The editor shows what it is about to keep — and it is not what came in.
  const photo = page.getByTestId('editor-photo');
  await expect(photo).toHaveCount(1, { timeout: 30_000 });
  const width = Number(await photo.getAttribute('data-width'));
  const height = Number(await photo.getAttribute('data-height'));
  const bytes = Number(await photo.getAttribute('data-bytes'));
  expect(Math.max(width, height), 'the photo was resized down').toBeLessThanOrEqual(PHOTO_MAX_EDGE);
  expect(width, 'it is still a picture, not a pixel').toBeGreaterThan(200);
  expect(bytes, 'it stores far less than it was given').toBeLessThan(big.length / 2);

  await page.getByTestId('editor-save').click();
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();

  // The list row carries a thumbnail, which is how you spot an instruction that
  // has a picture worth opening.
  await page.getByTestId('instruction-search').fill(number);
  const row = page.getByTestId('instruction-row').first();
  await expect(row.getByTestId('row-thumb')).toHaveCount(1);

  // And the instruction shows it.
  await row.click();
  await expect(page.locator('body[data-screen="instructionScreen"]')).toBeAttached();
  await expect(page.getByTestId('photos-section')).toBeVisible();
  const shown = page.getByTestId('photo-gallery').getByTestId('photo');
  await expect(shown).toHaveCount(1);
  await expect(shown).toHaveJSProperty('naturalWidth', width);

  // A photo is the heaviest thing in the database. It has to survive a restart.
  await restartApp(page);
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(number);
  await page.getByTestId('instruction-row').first().click();
  await expect(page.getByTestId('photo-gallery').getByTestId('photo')).toHaveCount(1);
  await expect(page.getByTestId('photo-gallery').getByTestId('photo'))
    .toHaveJSProperty('naturalWidth', width);
});
