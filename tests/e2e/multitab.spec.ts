import { expect, test } from '@playwright/test';
import { createTaskViaUi, openApp, resetWorkspace } from './helpers';

/**
 * Two tabs of the same origin share local storage. A tab with nothing pending
 * must pick up what another tab saved, and a tab with unsaved edits must not
 * lose them because another tab wrote first.
 */
test('two tabs stay consistent and unsaved edits are not destroyed', async ({ context, page }) => {
  await resetWorkspace(page);
  await openApp(page, '#/tasks');
  const second = await context.newPage();
  await openApp(second, '#/tasks');

  await createTaskViaUi(page, 'Made in tab one');
  await expect(second.getByTestId('task-item')).toContainText('Made in tab one');

  // Tab two edits a note title but the save is still debounced when tab one writes.
  await openApp(second, '#/notes');
  await second.getByTestId('new-note').click();
  await expect(page.getByTestId('nav-notes')).toContainText('1');
  await second.getByTestId('note-editor').getByLabel('Title').fill('Draft from tab two');
  await createTaskViaUi(page, 'Made while tab two was typing');
  await expect(second.getByTestId('note-save-state')).toHaveText('Saved');
  await second.reload();
  await openApp(second, '#/notes');
  await expect(second.getByTestId('note-item')).toContainText('Draft from tab two');
  await openApp(second, '#/tasks');
  await expect(second.getByTestId('task-item')).toHaveCount(2);
  await second.close();
});
