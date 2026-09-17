// Test 3: every screen opens, draws something, and raises no error.
//
// The broadest, cheapest guard there is. Each screen is reached the way a person
// reaches it — through the button that leads there — so this checks the wiring as
// well as the screen itself.
import { test, expect } from '@playwright/test';
import { openApp, openTab, freeNumber, openInstruction } from './_app.js';

test.setTimeout(120_000);

test('every screen opens without an error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|service worker|favicon/i.test(m.text())) return;
    errors.push(m.text());
  });

  await openApp(page);

  // Something to look at on the screens that show one instruction.
  const number = freeNumber();
  await openTab(page, 'instructions', 'instructionsListScreen');
  await page.getByTestId('instruction-new').click();
  await expect(page.locator('body[data-screen="editorScreen"]')).toBeAttached();
  await page.getByTestId('editor-number').fill(number);
  await page.getByTestId('editor-name').fill(`Tour ${Date.now()}`);
  await page.getByTestId('editor-steps').fill('One\nTwo');
  await page.getByTestId('editor-save').click();
  await expect(page.locator('body[data-screen="instructionsListScreen"]')).toBeAttached();

  const at = async (screenId, label) => {
    await expect(page.locator(`body[data-screen="${screenId}"]`), `${label} opens`).toBeAttached();
    const text = (await page.locator(`#${screenId}`).innerText()).trim();
    expect(text.length, `${label} has something on it`).toBeGreaterThan(10);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(wide, `${label} does not scroll sideways`).toBe(false);
    expect(errors, `${label} raised no error`).toEqual([]);
  };

  // The four tabs.
  await openTab(page, 'home', 'homeScreen'); await at('homeScreen', 'Home');
  await openTab(page, 'instructions', 'instructionsListScreen'); await at('instructionsListScreen', 'Instructions');
  await openTab(page, 'actions', 'actionsScreen'); await at('actionsScreen', 'Actions');
  await openTab(page, 'settings', 'settingsScreen'); await at('settingsScreen', 'Settings');

  // Everything reached from Settings.
  for (const [tid, screen, label] of [
    ['go-people', 'peopleScreen', 'People'],
    ['go-health', 'healthScreen', 'Library health'],
    ['go-datasafety', 'dataSafetyScreen', 'Data safety'],
    ['go-howitworks', 'howItWorksScreen', 'How it works'],
    ['go-versionlog', 'versionLogScreen', 'Version log'],
  ]) {
    await openTab(page, 'settings', 'settingsScreen');
    await page.getByTestId(tid).click();
    await at(screen, label);
  }

  // One instruction, and its editor.
  await openInstruction(page, number);
  await at('instructionScreen', 'One instruction');
  await page.getByTestId('instruction-edit').click();
  await at('editorScreen', 'The editor');

  // The two editors reached from their own tabs.
  await openTab(page, 'actions', 'actionsScreen');
  await page.getByTestId('action-new').click();
  await at('actionEditorScreen', 'New to-do');
  // 🪤 "+ Add Person" sits on SETTINGS, not on the People screen — so open it from
  // there directly. Walking to People first puts the button on a screen that is no
  // longer showing, and the click waits for a visibility that never comes.
  await openTab(page, 'settings', 'settingsScreen');
  await page.getByTestId('person-new').click();
  await at('personEditorScreen', 'New person');
});
