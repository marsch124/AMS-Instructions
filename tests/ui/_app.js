// Shared helpers for the UI tests. Controls are found by data-testid ONLY, never
// by the words on them — so the wording can change freely and a test only fails
// when something has actually stopped working.
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

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
//
// 🪤 Every click here is BOUNDED and its failure is swallowed on purpose. Screens
// swap under this helper — the button it found a moment ago can be on its way out
// by the time it clicks — and an unbounded click then waits out the WHOLE test
// timeout on an element that will never become visible again. That is two silent
// minutes and a red suite for no reason; it made this suite fail about one run in
// four. Look again instead.
export async function goBackToATab(page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await page.locator('#tabbar:not([hidden])').count()) return;

    const back = page.locator('.screen.active [data-testid="back"]').first();
    try {
      await back.click({ timeout: 2_000 });
    } catch {
      // Gone, or mid-transition. Fall through and look at what is there now.
    }
    await page.waitForTimeout(100);
  }

  // Say so plainly rather than letting the next line fail somewhere confusing.
  if (!(await page.locator('#tabbar:not([hidden])').count())) {
    const screen = await page.evaluate(() => document.body.dataset.screen);
    throw new Error(`Could not get back to a tab — still on "${screen}" after 8 tries.`);
  }
}

// Write one instruction and land back on the list. Three tests need something of
// their own to look at, and none of them are about the editor.
export async function writeInstruction(page, { number, name, steps = 'One\nTwo', frequency }) {
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-new').click();
  await expect(page.locator('body[data-screen="editorScreen"]')).toBeAttached();
  await page.getByTestId('editor-number').fill(number);
  await page.getByTestId('editor-name').fill(name);
  await page.getByTestId('editor-steps').fill(steps);
  if (frequency) await page.getByTestId('editor-frequency').selectOption(frequency);
  await page.getByTestId('editor-save').click();
  // 🪤 Wait for the list before doing anything else. Saving is asynchronous, and a
  // tab tapped while the editor is still on screen hits a button that is on its
  // way out — the click then waits for a visibility that never comes.
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();
}

// Open the instruction with this number, from the list. Browsing folds them into
// category folders, so searching is both what a person does and what puts the row
// in the DOM at all.
//
// 🪤 Click the row that CARRIES THE NUMBER, never `.first()`. Filling the search
// box and clicking whatever is first is a race: the list has not necessarily
// narrowed yet, so the tap lands on the previous instruction. The test then fails
// further down, reading the wrong instruction's numbers, and only sometimes —
// which is exactly how it reached CI green locally and red there.
export async function openInstruction(page, number) {
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-search').fill(number);
  await expect(rows(page, number)).toHaveCount(1);
  await rows(page, number).click();
  await expect(page.locator('body[data-screen="instructionScreen"]')).toBeAttached();
}

// Instruction rows ON THE SCREEN YOU ARE LOOKING AT.
//
// 🪤 Every screen stays in the DOM — only one carries `.active` — and the same row
// markup is used by the instructions list AND the Due screen. A page-wide
// getByTestId('instruction-row') therefore counts rows nobody can see, and
// "3 elements" is how that shows up. Scope to the active screen, as a person does.
export function rows(page, number) {
  const suffix = number ? `[data-number="${number}"]` : '';
  return page.locator(`.screen.active [data-testid="instruction-row"]${suffix}`);
}

// A three-digit number no starter-library instruction is already using.
//
// 🪤 This bit me: the starter library holds 205 instructions spread over 100–909,
// and a test that picked its own number "out of the way" was really tossing a
// coin. The app does not refuse a duplicate number — it just writes a second
// instruction with the same one — so a collision does not fail loudly, it makes
// the test open the wrong row and fail somewhere else entirely, and only
// sometimes. Read the library and pick from what is actually free.
const LIBRARY_NUMBERS = (() => {
  const file = new URL('../../AMS-Instructions-starter-library.json', import.meta.url);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const items = Array.isArray(parsed) ? parsed : (parsed.instructions || []);
  return new Set(items.map(item => String(item.number)));
})();

const usedThisRun = new Set();

export function freeNumber() {
  for (let n = 100; n <= 999; n++) {
    const number = String(n);
    if (LIBRARY_NUMBERS.has(number) || usedThisRun.has(number)) continue;
    usedThisRun.add(number);
    return number;
  }
  throw new Error('no free instruction number left');
}

// Somebody to name. Several tests need a person before they can record who did
// what; none of them are about the People editor.
export async function addPerson(page, name) {
  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('person-new').click();
  await expect(page.locator('body[data-screen="personEditorScreen"]')).toBeAttached();
  await page.getByTestId('person-name').fill(name);
  await page.getByTestId('person-save').click();
  await expect(page.locator('body[data-screen="personEditorScreen"]')).not.toBeAttached();
  return name;
}
