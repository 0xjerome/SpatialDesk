import { expect, test } from '@playwright/test';
import { PROD_PORT } from '../../playwright.config';

/**
 * The built client served by server/index.js (no Vite, no emulator). This is
 * what a deployment runs, so the journey checks routing, assets, headers, the
 * honest "not configured" assistant state and the honest XR state on a
 * desktop browser without a headset.
 */
test.use({ baseURL: `http://127.0.0.1:${PROD_PORT}` });

test('production build serves the app and reports capabilities honestly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome to SpatialDesk');

  await page.getByTestId('home-new-task').click();
  await page.getByTestId('task-dialog').getByLabel('Title').fill('Production task');
  await page.getByTestId('task-save').click();
  await page.reload();
  await expect(page.getByTestId('task-item')).toContainText('Production task');

  await page.goto('/#/assistant');
  await expect(page.getByTestId('ai-status')).toContainText('not configured');

  await page.goto('/#/spatial');
  await expect(page.getByTestId('xr-status')).not.toContainText('Emulated');
  // Headless desktop Chrome exposes navigator.xr but supports no immersive session.
  await expect(page.getByTestId('xr-blocked')).toBeVisible();
  await expect(page.getByTestId('xr-enter')).toBeDisabled();
  await page.getByTestId('xr-preview').click();
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __spatialdesk: { xr: { panels: { bound: { value: boolean } } | null } };
        }
      ).__spatialdesk.xr.panels?.bound.value === true,
    null,
    { timeout: 90_000 },
  );
  await page.getByTestId('xr-overlay-back').click();

  // Deep link to an unknown path without extension still serves the app.
  const deep = await page.goto('/some/deep/link');
  expect(deep?.status()).toBe(200);
  expect(errors).toEqual([]);
});
