// Test 20: on an iPhone opened from the Home Screen, iOS 26 draws a soft blur
// over the strip just under the clock (measured on his phone with AMS ColdShower:
// flat at the top inset, fading out ~45–50 pt lower). Every screen's top bar —
// title, ← Back, ＋, ★ — must start clear of it. On a screen with no top inset
// (the Mac, a desktop browser) nothing moves.
//
// All screens share ONE header rule (.app-header), so this walks one of each
// kind: Home's title + version, a tab's ＋, an instruction's ← Back and ★, and a
// Settings sub-screen's ← Back.
import { test, expect } from '@playwright/test';
import { openApp, restartApp, openTab, writeInstruction, openInstruction, freeNumber } from './_app.js';

// The phone's real top / bottom insets (iPhone 17 Pro class), applied by the
// browser engine itself so the page's own env(safe-area-inset-*) sees them.
async function insets(page, top, bottom) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, bottom } });
}

// Top edge of the control with this test id ON THE SCREEN BEING SHOWN — every
// screen stays in the DOM, and several share the same id (← Back is `back`).
const topOf = (page, id) => page.locator(`.screen.active [data-testid="${id}"]`).first()
  .evaluate((el) => el.getBoundingClientRect().top);

const CLEAR = 62 + 48;

test('every top bar starts below the blur under the clock', async ({ page }) => {
  await insets(page, 62, 34);
  await openApp(page);

  // Home: the title and the version badge under it.
  expect(await topOf(page, 'home-title'), 'Home title').toBeGreaterThanOrEqual(CLEAR);
  expect(await topOf(page, 'app-version'), 'Home version').toBeGreaterThanOrEqual(CLEAR);

  // A tab with a button in its top bar.
  await openTab(page, 'actions', 'actionsScreen');
  expect(await topOf(page, 'action-new'), 'Actions ＋').toBeGreaterThanOrEqual(CLEAR);

  // One instruction: ← Back on the left, ★ on the right.
  const number = freeNumber();
  await writeInstruction(page, { number, name: `Clock ${Date.now()}` });
  expect(await topOf(page, 'instruction-new'), 'Instructions ＋').toBeGreaterThanOrEqual(CLEAR);
  await openInstruction(page, number);
  expect(await topOf(page, 'back'), 'Instruction ← Back').toBeGreaterThanOrEqual(CLEAR);
  expect(await topOf(page, 'instruction-favourite'), 'Instruction ★').toBeGreaterThanOrEqual(CLEAR);

  // A screen reached from Settings.
  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('go-people').click();
  await expect(page.locator('body[data-screen="peopleScreen"]')).toBeAttached();
  expect(await topOf(page, 'back'), 'People ← Back').toBeGreaterThanOrEqual(CLEAR);

  // No inset (no clock strip — the Mac): the top bar stays where it always was.
  await insets(page, 0, 0);
  await restartApp(page);
  expect(await topOf(page, 'home-title'), 'Home title, no inset').toBeLessThan(30);
});
