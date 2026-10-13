import { expect, test } from '@playwright/test';
import { createTaskViaUi, openApp, resetWorkspace } from './helpers';

test.describe('assistant without credentials', () => {
  test('shows an honest unconfigured state and keeps buttons disabled', async ({ page }) => {
    await resetWorkspace(page);
    await openApp(page, '#/tasks');
    await createTaskViaUi(page, 'Something to organise');
    await openApp(page, '#/assistant');
    await expect(page.getByTestId('ai-status')).toContainText('not configured');
    await expect(page.getByTestId('ai-organize')).toBeDisabled();
    await expect(page.getByTestId('ai-summarize')).toBeDisabled();
  });

  test('surfaces a server error from a note draft request', async ({ page }) => {
    await resetWorkspace(page);
    await openApp(page, '#/notes');
    await page.getByTestId('new-note').click();
    await page
      .getByTestId('note-editor')
      .getByLabel('Body')
      .fill('Call the vendor and ship the build.');
    await page.getByTestId('note-draft-tasks').click();
    await expect(page.getByTestId('toast')).toContainText('not configured');
    await expect(page.getByTestId('draft-dialog')).toHaveCount(0);
  });

  test('handles a provider outage gracefully', async ({ page }) => {
    await page.route('**/api/ai/status', (route) =>
      route.fulfill({
        json: {
          configured: true,
          provider: 'anthropic',
          model: 'test',
          limits: { maxInputChars: 1000 },
        },
      }),
    );
    await page.route('**/api/ai/assist', (route) =>
      route.fulfill({ status: 502, json: { error: { code: 'provider_error', message: 'down' } } }),
    );
    await resetWorkspace(page);
    await openApp(page, '#/assistant');
    await expect(page.getByTestId('ai-status')).toContainText('Assistant ready');
    await page
      .getByLabel('Paste text to summarise')
      .fill('A long enough piece of text to summarise here.');
    await page.getByTestId('ai-summarize').click();
    await expect(page.getByTestId('toast')).toContainText('provider returned an error');
  });

  test('rejects malformed assistant output instead of showing it', async ({ page }) => {
    await page.route('**/api/ai/status', (route) =>
      route.fulfill({
        json: {
          configured: true,
          provider: 'anthropic',
          model: 'test',
          limits: { maxInputChars: 1000 },
        },
      }),
    );
    await page.route('**/api/ai/assist', (route) =>
      route.fulfill({ json: { action: 'summarize', result: { summary: 42 } } }),
    );
    await resetWorkspace(page);
    await openApp(page, '#/assistant');
    await page
      .getByLabel('Paste text to summarise')
      .fill('A long enough piece of text to summarise here.');
    await page.getByTestId('ai-summarize').click();
    await expect(page.getByTestId('toast')).toContainText('unexpected');
    await expect(page.getByTestId('ai-summary-result')).toHaveCount(0);
  });

  test('renders validated suggestions and lets the user apply one', async ({ page }) => {
    await page.route('**/api/ai/status', (route) =>
      route.fulfill({
        json: {
          configured: true,
          provider: 'anthropic',
          model: 'test',
          limits: { maxInputChars: 1000 },
        },
      }),
    );
    await resetWorkspace(page);
    await openApp(page, '#/tasks');
    await createTaskViaUi(page, 'Fix the build');
    const taskId = await page.evaluate(
      () =>
        (window as unknown as { __spatialdesk: { store: { tasks: { value: { id: string }[] } } } })
          .__spatialdesk.store.tasks.value[0]!.id,
    );
    await page.route('**/api/ai/assist', (route) =>
      route.fulfill({
        json: {
          action: 'organize_tasks',
          model: 'test',
          result: {
            groups: [
              { name: 'Engineering', taskIds: [taskId, 'bogus-id'], rationale: 'code work' },
            ],
            suggestions: [{ taskId, priority: 'high', dueDate: null, reason: 'blocks release' }],
          },
        },
      }),
    );
    await openApp(page, '#/assistant');
    await page.getByTestId('ai-organize').click();
    const result = page.getByTestId('ai-organize-result');
    await expect(result).toContainText('Engineering');
    await expect(result).not.toContainText('bogus-id');
    await result.getByRole('button', { name: 'Apply' }).click();
    await openApp(page, '#/tasks');
    await expect(page.getByTestId('task-item').first().getByText('High')).toBeVisible();
  });
});

test.describe('settings', () => {
  test('exports, clears and imports workspace data', async ({ page }) => {
    await resetWorkspace(page);
    await openApp(page, '#/tasks');
    await createTaskViaUi(page, 'Exported task');
    await openApp(page, '#/settings');
    await expect(page.getByTestId('data-counts')).toContainText('1 tasks');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export').click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    await page.getByTestId('clear-all').click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByTestId('data-counts')).toContainText('0 tasks');

    await page.getByTestId('import-file').setInputFiles(path!);
    await expect(page.getByTestId('data-counts')).toContainText('1 tasks');
    await openApp(page, '#/tasks');
    await expect(page.getByTestId('task-item')).toContainText('Exported task');
  });

  test('rejects an invalid import file', async ({ page }) => {
    await resetWorkspace(page);
    await openApp(page, '#/settings');
    await page.getByTestId('import-file').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not json'),
    });
    await expect(page.getByTestId('toast')).toContainText('not a valid SpatialDesk export');
  });
});

test.describe('voice', () => {
  test('explains when speech recognition is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', {
        value: undefined,
        configurable: true,
      });
    });
    await resetWorkspace(page);
    await openApp(page, '#/');
    await expect(page.getByTestId('voice-open')).toHaveCount(0);
    await openApp(page, '#/settings');
    await expect(page.getByText(/Speech recognition is not available/)).toBeVisible();
  });

  test('proposes an action from a fake recogniser and requires confirmation', async ({ page }) => {
    await page.addInitScript(() => {
      class FakeRecognition extends EventTarget {
        lang = '';
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onstart: (() => void) | null = null;
        start() {
          setTimeout(() => {
            this.onresult?.({
              resultIndex: 0,
              results: [
                Object.assign([{ transcript: 'add a task to call the dentist', confidence: 0.9 }], {
                  isFinal: true,
                }),
              ],
            });
            this.onend?.();
          }, 50);
        }
        stop() {}
        abort() {
          this.onerror?.({ error: 'aborted' });
        }
      }
      Object.defineProperty(window, 'SpeechRecognition', {
        value: FakeRecognition,
        configurable: true,
      });
    });
    await resetWorkspace(page);
    await openApp(page, '#/');
    await page.getByTestId('voice-open').click();
    await expect(page.getByTestId('voice-transcript')).toContainText('call the dentist');
    await expect(page.getByTestId('voice-proposal')).toContainText('Create task');
    // Nothing is saved before confirmation.
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __spatialdesk: { store: { tasks: { value: unknown[] } } } })
            .__spatialdesk.store.tasks.value.length,
      ),
    ).toBe(0);
    await page.getByTestId('voice-confirm').click();
    await openApp(page, '#/tasks');
    await expect(page.getByTestId('task-item')).toContainText('Call the dentist');
  });
});
