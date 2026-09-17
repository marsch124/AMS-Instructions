// Shared helpers for the UI tests. Controls are found by data-testid ONLY, never
// by the words on them — so the wording can change freely and a test only fails
// when something has actually stopped working.
import { expect } from '@playwright/test';

// Open the app fresh and wait until it has finished starting.
export async function openApp(page) {
  await page.goto('/index.html');
  await settled(page);
}

// A genuine restart.
//
// 🪤 page.goto() to the URL the page is ALREADY on can be a no-op navigation, and
// `data-ready` would still be set from the first load — so waiting for it would
// prove nothing. Reload explicitly when a test needs the app to run again.
export async function restartApp(page) {
  await page.reload();
  await settled(page);
}

// Booted: the database is open and the first screen is drawn.
async function settled(page) {
  await expect(page.locator('html[data-ready="1"]')).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('body[data-screen="homeScreen"]')).toBeAttached({ timeout: 20_000 });
}

// Move to one of the four tabs and wait for its screen to actually be on show.
//
// 🪤 The tab bar is HIDDEN on any detail screen (an instruction, an editor, the
// People list) — by design: you get a ← Back instead. So step back out first, or
// the tab is in the DOM but unclickable and the test hangs until it times out.
export async function openTab(page, tab, screenId) {
  await goBackToATab(page);
  await page.getByTestId(`tab-${tab}`).click();
  await expect(page.locator(`body[data-screen="${screenId}"]`)).toBeAttached();
}

// Press ← Back until the tab bar is showing again.
export async function goBackToATab(page) {
  for (let i = 0; i < 6; i++) {
    if (await page.locator('#tabbar:not([hidden])').count()) return;
    const back = page.locator('.screen.active [data-testid="back"]');
    if (!(await back.count())) return;
    await back.first().click();
    await page.waitForTimeout(80);
  }
}
