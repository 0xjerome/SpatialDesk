import { expect, test } from '@playwright/test';
import { createTaskViaUi, openApp, resetWorkspace } from './helpers';

test.describe('tasks', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('create, complete, reopen, edit, filter and delete a task', async ({ page }) => {
    await openApp(page, '#/tasks');
    await expect(page.getByText('No tasks yet')).toBeVisible();

    await createTaskViaUi(page, 'Write the launch checklist', {
      priority: 'high',
      dueDate: '2030-01-15',
    });
    const item = page.getByTestId('task-item').filter({ hasText: 'Write the launch checklist' });
    await expect(item).toBeVisible();
    await expect(item.getByText('High')).toBeVisible();
    await expect(item.getByText(/Due Jan 15, 2030/)).toBeVisible();

    // Validation: empty title is rejected and nothing is created.
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-save').click();
    await expect(page.getByRole('alert')).toContainText('Give the task a title');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('task-item')).toHaveCount(1);

    // Complete: disappears from the Open filter, shows under Done.
    await item.getByRole('checkbox').click();
    await expect(page.getByTestId('task-item')).toHaveCount(0);
    await page.getByLabel('Filter by status').selectOption('done');
    await expect(page.getByTestId('task-item')).toHaveCount(1);
    await expect(page.getByTestId('task-item').first()).toHaveClass(/item-done/);

    // Reopen.
    await page.getByTestId('task-item').first().getByRole('checkbox').click();
    await page.getByLabel('Filter by status').selectOption('open');
    await expect(page.getByTestId('task-item')).toHaveCount(1);

    // Edit.
    await page.getByTestId('task-item').first().getByTestId('task-title').click();
    const dialog = page.getByTestId('task-dialog');
    await dialog.getByLabel('Title').fill('Write the launch checklist v2');
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-item').first()).toContainText('v2');

    // Search filters.
    await createTaskViaUi(page, 'Buy batteries');
    await page.getByLabel('Search tasks').fill('batter');
    await expect(page.getByTestId('task-item')).toHaveCount(1);
    await expect(page.getByTestId('task-item').first()).toContainText('Buy batteries');
    await page.getByLabel('Search tasks').fill('');
    await expect(page.getByTestId('task-item')).toHaveCount(2);

    // Delete with confirmation and undo.
    await page.getByRole('button', { name: 'Delete Buy batteries' }).click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByTestId('task-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('task-item')).toHaveCount(2);
  });

  test('changes persist across a reload', async ({ page }) => {
    await openApp(page, '#/tasks');
    await createTaskViaUi(page, 'Persist me');
    await page.getByTestId('task-item').first().getByRole('checkbox').click();
    await expect(page.getByTestId('task-item')).toHaveCount(0);
    await page.reload();
    await openApp(page, '#/tasks');
    await page.getByLabel('Filter by status').selectOption('all');
    const item = page.getByTestId('task-item').filter({ hasText: 'Persist me' });
    await expect(item).toBeVisible();
    await expect(item.getByRole('checkbox')).toBeChecked();
  });
});
