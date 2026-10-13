import { expect, test, type Page } from '@playwright/test';
import { createTaskViaUi, openApp, resetWorkspace } from './helpers';

/**
 * Immersive journeys run against the IWER emulator that the IWSDK dev plugin
 * injects on localhost. They prove application logic (capability detection,
 * session lifecycle, panel binding, cleanup) but not physical-device behaviour.
 */

type XrWindow = Window & {
  __spatialdesk: {
    xr: {
      phase: { value: string };
      error: { value: string | null };
      mode: { value: string | null };
      sessionsStarted: { value: number };
      world: {
        session?: unknown;
        sessionRequestPending: boolean;
        visibilityState: { value: string };
      } | null;
      panels: {
        bound: { value: boolean };
        section: { value: string };
        selected: { value: { kind: string; id: string } | null };
        status: { value: string };
        showSection: (s: string) => void;
        activateRow: (i: number) => void;
        toggleRow: (i: number) => void;
        quickAdd: () => void;
        focusQuickAdd: () => void;
        exit: () => void;
        element: (
          panel: 'main' | 'detail',
          id: string,
        ) => { properties: { value: { text?: string } } } | null;
      } | null;
    };
    store: { tasks: { value: { title: string; status: string }[] } };
  };
};

const xr = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as XrWindow;
    return {
      phase: w.__spatialdesk.xr.phase.value,
      error: w.__spatialdesk.xr.error.value,
      mode: w.__spatialdesk.xr.mode.value,
      sessions: w.__spatialdesk.xr.sessionsStarted.value,
      hasSession: Boolean(w.__spatialdesk.xr.world?.session),
      visibility: w.__spatialdesk.xr.world?.visibilityState.value ?? null,
      hasWorld: w.__spatialdesk.xr.world !== null,
    };
  });

const waitPhase = (page: Page, phases: string[]) =>
  page.waitForFunction(
    (list) => list.includes((window as unknown as XrWindow).__spatialdesk.xr.phase.value),
    phases,
    { timeout: 60_000 },
  );

test.describe('spatial workspace', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('reports an unsupported browser honestly and keeps the app usable', async ({ page }) => {
    await openApp(page, '#/spatial');
    await expect(page.getByTestId('xr-status')).toContainText('Emulated');
    // Remove WebXR after the emulator has installed it, then re-run detection.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'xr', { value: undefined, configurable: true });
    });
    await page.getByRole('button', { name: 'Re-check' }).click();
    await expect(page.getByTestId('xr-blocked')).toContainText('does not expose WebXR');
    await expect(page.getByTestId('xr-enter')).toBeDisabled();
    await expect(page.getByTestId('xr-status')).toContainText('Not available');
    // The preview still works without WebXR.
    await page.getByTestId('xr-preview').click();
    await page.waitForFunction(
      () => (window as unknown as XrWindow).__spatialdesk.xr.panels?.bound.value === true,
      null,
      { timeout: 60_000 },
    );
    await expect(page.getByTestId('xr-overlay')).toBeVisible();
    await page.getByTestId('xr-overlay-back').click();
    await expect(page.getByTestId('xr-overlay')).toHaveCount(0);
    await openApp(page, '#/tasks');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tasks');
  });

  test('reports a denied session request instead of pretending', async ({ page }) => {
    await openApp(page, '#/spatial');
    await expect(page.getByTestId('xr-enter')).toBeEnabled();
    await page.evaluate(() => {
      const xrSystem = navigator.xr as unknown as { requestSession: () => Promise<never> };
      xrSystem.requestSession = () =>
        Promise.reject(new DOMException('User denied', 'NotAllowedError'));
    });
    await page.getByTestId('xr-enter').click();
    await waitPhase(page, ['preview', 'error']);
    const state = await xr(page);
    expect(state.hasSession).toBe(false);
    expect(state.sessions).toBe(0);
    await expect(page.getByTestId('xr-error')).toContainText('not started');
    await expect(page.getByTestId('xr-active')).toHaveCount(0);
  });

  test('binds panels to real data in the browser preview', async ({ page }) => {
    await openApp(page, '#/tasks');
    await createTaskViaUi(page, 'Pack the headset', { priority: 'high', dueDate: '2000-01-01' });
    await createTaskViaUi(page, 'Charge controllers');
    await openApp(page, '#/spatial');
    await page.getByTestId('xr-preview').click();
    await page.waitForFunction(
      () => (window as unknown as XrWindow).__spatialdesk.xr.panels?.bound.value === true,
      null,
      { timeout: 60_000 },
    );
    const text = (panel: 'main' | 'detail', id: string) =>
      page.evaluate(
        ([p, i]) =>
          (window as unknown as XrWindow).__spatialdesk.xr.panels?.element(
            p as 'main' | 'detail',
            i,
          )?.properties.value.text ?? null,
        [panel, id],
      );
    expect(await text('main', 'subtitle')).toContain('2 open tasks');
    expect(await text('main', 'subtitle')).toContain('1 overdue');
    await page.evaluate(() => {
      const p = (window as unknown as XrWindow).__spatialdesk.xr.panels!;
      p.showSection('tasks');
      p.activateRow(0);
    });
    expect(await text('main', 'row-0-title')).toBe('Pack the headset');
    expect(await text('main', 'row-0-meta')).toContain('Overdue 2000-01-01');
    expect(await text('detail', 'title')).toBe('Pack the headset');
    expect(await text('detail', 'primary-label')).toBe('Complete');
    await page.evaluate(() =>
      (window as unknown as XrWindow).__spatialdesk.xr.panels!.toggleRow(0),
    );
    expect(await text('main', 'status')).toContain('Completed "Pack the headset"');
    // Quick add: the UIKit text field is backed by a real DOM input, so typing
    // works with a keyboard here and with the system keyboard on a headset.
    await page.evaluate(() =>
      (window as unknown as XrWindow).__spatialdesk.xr.panels!.focusQuickAdd(),
    );
    await page.keyboard.type('Charge the headset');
    await page.evaluate(() => (window as unknown as XrWindow).__spatialdesk.xr.panels!.quickAdd());
    expect(await text('main', 'status')).toContain('Added "Charge the headset"');
    expect(
      await page.evaluate(() =>
        (window as unknown as XrWindow).__spatialdesk.store.tasks.value.map((t) => t.title),
      ),
    ).toContain('Charge the headset');
    // The shared store changed, so the 2D app reflects it after leaving the preview.
    await page.getByTestId('xr-overlay-back').click();
    await openApp(page, '#/tasks');
    await page.getByLabel('Filter by status').selectOption('done');
    await expect(page.getByTestId('task-item')).toContainText('Pack the headset');
  });

  test('enters, exits and re-enters an emulated immersive session without corrupting state', async ({
    page,
  }) => {
    await openApp(page, '#/tasks');
    await createTaskViaUi(page, 'Immersive task');
    await openApp(page, '#/spatial');
    await expect(page.getByTestId('xr-status')).toContainText('Emulated');
    await page.getByTestId('xr-enter').click();
    await waitPhase(page, ['immersive', 'error']);
    let state = await xr(page);
    expect(state.phase).toBe('immersive');
    expect(state.hasSession).toBe(true);
    expect(state.visibility).toBe('visible');
    expect(state.sessions).toBe(1);
    expect(state.mode).toBe('immersive-ar');

    await page.waitForFunction(
      () => (window as unknown as XrWindow).__spatialdesk.xr.panels?.bound.value === true,
      null,
      { timeout: 60_000 },
    );
    // Leave through the panel's own Exit handler, the same code path the in-XR button uses.
    await page.evaluate(() => (window as unknown as XrWindow).__spatialdesk.xr.panels!.exit());
    await waitPhase(page, ['preview']);
    state = await xr(page);
    expect(state.hasSession).toBe(false);
    expect(state.visibility).toBe('non-immersive');

    await page.getByTestId('xr-overlay-enter').click();
    await waitPhase(page, ['immersive', 'error']);
    state = await xr(page);
    expect(state.phase).toBe('immersive');
    expect(state.sessions).toBe(2);
    await page.evaluate(() => (window as unknown as XrWindow).__spatialdesk.xr.panels!.exit());
    await waitPhase(page, ['preview']);
    await page.getByTestId('xr-overlay-back').click();
    state = await xr(page);
    expect(state.phase).toBe('idle');
    expect(state.hasWorld).toBe(false);
    expect(
      await page.evaluate(() => document.getElementById('scene-container')?.childElementCount),
    ).toBe(0);

    await openApp(page, '#/tasks');
    await expect(page.getByTestId('task-item')).toContainText('Immersive task');
  });
});
