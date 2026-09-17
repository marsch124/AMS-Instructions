// Test 15: the audit log — a record whose failure would be silent.
//
// You write down what an inspection found, and then you rely on it being there
// months later. If it quietly failed to save you would not find out at the time;
// you would find out when you went looking for it and it was gone. The test also
// covers the thing the audit log exists FOR: turning a finding into a to-do, so
// "the seal is cracked" becomes something that actually gets done.
import { test, expect } from '@playwright/test';
import { openApp, openTab, restartApp, writeInstruction, openInstruction, freeNumber, addPerson } from './_app.js';

test.setTimeout(120_000);

test('an audit is recorded, kept, and can become a to-do', async ({ page }) => {
  const said = [];
  page.on('dialog', (d) => { said.push(d.message()); d.dismiss(); });

  await openApp(page);
  const number = freeNumber();
  const name = `Inspected thing ${Date.now()}`;
  const who = `Inspector ${Date.now()}`;
  const finding = `The seal is cracked ${Date.now()}`;

  await addPerson(page, who);
  await writeInstruction(page, { number, name });
  await openInstruction(page, number);
  await page.getByTestId('fold-audit').click();

  // It refuses an audit with nobody's name on it — an unattributed finding is
  // not a record, and silently saving one would be worse than refusing.
  await page.getByTestId('audit-findings').fill(finding);
  await page.getByTestId('audit-add').click();
  await expect.poll(() => said.length, { message: 'an audit with no auditor is refused' }).toBeGreaterThan(0);
  await expect(page.getByTestId('audit-log').getByTestId('audit-entry')).toHaveCount(0);

  // And an audit that found nothing to say.
  said.length = 0;
  await page.getByTestId('audit-who').selectOption({ label: who });
  await page.getByTestId('audit-findings').fill('');
  await page.getByTestId('audit-add').click();
  await expect.poll(() => said.length, { message: 'an audit with no findings is refused' }).toBeGreaterThan(0);
  await expect(page.getByTestId('audit-log').getByTestId('audit-entry')).toHaveCount(0);

  // Now a real one.
  await page.getByTestId('audit-who').selectOption({ label: who });
  await page.getByTestId('audit-findings').fill(finding);
  await page.getByTestId('audit-add').click();
  const entry = page.getByTestId('audit-log').getByTestId('audit-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(who);
  await expect(entry).toContainText(finding);
  await expect(entry).toHaveAttribute('data-actioned', '0');

  // Written down, not just displayed.
  await restartApp(page);
  await openInstruction(page, number);
  await page.getByTestId('fold-audit').click();
  const kept = page.getByTestId('audit-log').getByTestId('audit-entry');
  await expect(kept).toHaveCount(1);
  await expect(kept).toContainText(finding);

  // A finding that becomes a to-do is the point of writing it down. Convert opens
  // the to-do editor ready-filled from the finding — you get to word it and give
  // it a date before it is real.
  await kept.getByTestId('audit-convert').click();
  await expect(page.locator('body[data-screen="actionEditorScreen"]')).toBeAttached();
  await expect(page.getByTestId('action-title'), 'the to-do arrives ready-written').toHaveValue(finding);
  await expect(page.getByTestId('action-notes')).toHaveValue(finding);
  await page.getByTestId('action-due').fill('2026-12-24');
  await page.getByTestId('action-save').click();

  // Back on the audit, which now says it has been dealt with — so the same
  // finding cannot be raised twice.
  await expect(page.getByTestId('audit-log').getByTestId('audit-entry'))
    .toHaveAttribute('data-actioned', '1');
  await expect(page.getByTestId('audit-actioned'), 'it says so, so you cannot raise it twice').toBeVisible();

  // And the to-do is really on the Actions tab, pointing back at the instruction.
  await openTab(page, 'actions', 'actionsScreen');
  const todo = page.getByTestId('open-actions').getByTestId('action-row').filter({ hasText: finding });
  await expect(todo).toHaveCount(1);
  await expect(todo, 'the to-do carries the instruction number').toContainText(number);
});
