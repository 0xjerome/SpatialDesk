import { expect, test } from '@playwright/test';
import { createTaskViaUi, openApp, resetWorkspace } from './helpers';

test.describe('notes', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('create, edit with autosave, search and delete a note', async ({ page }) => {
    await openApp(page, '#/notes');
    await page.getByTestId('new-note').click();
    const editor = page.getByTestId('note-editor');
    await expect(editor).toBeVisible();
    await editor.getByLabel('Title').fill('Standup notes');
    await editor.getByLabel('Body').fill('Line one\nLine two about WebXR');
    await expect(page.getByTestId('note-save-state')).toHaveText('Saved');

    await page.reload();
    await openApp(page, '#/notes');
    await expect(page.getByTestId('note-item').filter({ hasText: 'Standup notes' })).toBeVisible();
    await page.getByLabel('Search notes').fill('webxr');
    await expect(page.getByTestId('note-item')).toHaveCount(1);
    await page.getByLabel('Search notes').fill('nothing-here');
    await expect(page.getByText(/No notes match/)).toBeVisible();
    await page.getByLabel('Search notes').fill('');

    await page.getByTestId('note-item').first().getByRole('link').click();
    await expect(page.getByTestId('note-editor').getByLabel('Body')).toHaveValue(
      'Line one\nLine two about WebXR',
    );
    await page.getByTestId('note-delete').click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByText('No notes yet')).toBeVisible();
  });
});

test.describe('projects', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('create a project, link a task, see real progress, delete and keep records', async ({
    page,
  }) => {
    await openApp(page, '#/projects');
    await page.getByTestId('new-project').click();
    const dialog = page.getByTestId('project-dialog');
    await dialog.getByLabel('Name').fill('Quest launch');
    await dialog.getByLabel('Description').fill('Everything needed to ship');
    await page.getByTestId('project-save').click();
    await expect(page.getByTestId('project-card')).toHaveCount(1);
    await expect(page.getByTestId('project-card')).toContainText('No tasks yet');

    await page.getByTestId('project-card').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Quest launch');
    await page.getByTestId('project-new-task').click();
    await page.getByTestId('task-dialog').getByLabel('Title').fill('Record trailer');
    await expect(page.getByTestId('task-dialog').getByLabel('Project')).toHaveValue(/.+/);
    await page.getByTestId('task-save').click();
    await page.getByTestId('project-new-task').click();
    await page.getByTestId('task-dialog').getByLabel('Title').fill('Write listing');
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-item')).toHaveCount(2);
    await expect(page.getByText('0%')).toBeVisible();
    await page
      .getByTestId('task-item')
      .filter({ hasText: 'Record trailer' })
      .getByRole('checkbox')
      .click();
    await expect(page.getByText('50%')).toBeVisible();

    await page.getByTestId('project-delete').click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByText('No projects yet')).toBeVisible();
    await openApp(page, '#/tasks');
    await page.getByLabel('Filter by status').selectOption('all');
    await expect(page.getByTestId('task-item')).toHaveCount(2);
  });
});

test.describe('research', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('validates links, saves tags and filters', async ({ page }) => {
    await openApp(page, '#/research');
    await page.getByTestId('new-research').click();
    const dialog = page.getByTestId('research-dialog');
    await dialog.getByLabel('Title').fill('Hand input spec');
    await dialog.getByLabel('Link').fill('javascript:alert(1)');
    await page.getByTestId('research-save').click();
    await expect(dialog.getByRole('alert')).toContainText('Only http and https');
    await dialog.getByLabel('Link').fill('immersive-web.github.io/webxr-hand-input/');
    await dialog.getByLabel('Tags').fill('WebXR, hands');
    await page.getByTestId('research-save').click();
    const item = page.getByTestId('research-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByRole('link', { name: /immersive-web/ })).toHaveAttribute(
      'href',
      'https://immersive-web.github.io/webxr-hand-input/',
    );
    await expect(item.getByText('#webxr')).toBeVisible();
    await page.getByRole('button', { name: '#hands' }).click();
    await expect(page.getByTestId('research-item')).toHaveCount(1);
    await page.getByLabel('Search research').fill('nope');
    await expect(page.getByText('Nothing matches')).toBeVisible();
  });
});

test.describe('home', () => {
  test('shows real counts from stored data', async ({ page }) => {
    await resetWorkspace(page);
    await openApp(page, '#/tasks');
    await createTaskViaUi(page, 'Overdue thing', { dueDate: '2000-01-01' });
    await createTaskViaUi(page, 'Future thing', { dueDate: '2099-01-01' });
    await openApp(page, '#/');
    const kpis = page.getByLabel('Workspace summary');
    await expect(kpis).toContainText('2');
    await expect(kpis.getByText('Overdue')).toBeVisible();
    await expect(
      page
        .getByTestId('task-item')
        .filter({ hasText: 'Overdue thing' })
        .getByText(/Overdue · /),
    ).toBeVisible();
  });
});
