import { expect, type Page } from '@playwright/test';

export async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export async function resetWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
}

export async function createTaskViaUi(
  page: Page,
  title: string,
  options: { priority?: 'low' | 'medium' | 'high'; dueDate?: string } = {},
): Promise<void> {
  await page.getByTestId('new-task').click();
  const dialog = page.getByTestId('task-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title').fill(title);
  if (options.priority) await dialog.getByLabel('Priority').selectOption(options.priority);
  if (options.dueDate) await dialog.getByLabel('Due date').fill(options.dueDate);
  await page.getByTestId('task-save').click();
  await expect(dialog).toBeHidden();
}
