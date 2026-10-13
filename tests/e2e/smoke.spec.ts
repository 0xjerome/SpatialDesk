import { expect, test } from '@playwright/test';
import { openApp, resetWorkspace } from './helpers';

test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('renders every route without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    for (const route of [
      '#/',
      '#/tasks',
      '#/notes',
      '#/projects',
      '#/research',
      '#/assistant',
      '#/settings',
      '#/spatial',
    ]) {
      await openApp(page, route);
    }
    expect(errors.filter((e) => !/favicon|IWSDK Dev|IWER/i.test(e))).toEqual([]);
  });
});
