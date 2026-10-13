import { useEffect, useRef, useState } from 'preact/hooks';
import { serializeWorkspace } from '../../domain/persistence';
import { useApp } from '../context';
import { Banner, Button, ConfirmDialog, Field } from '../components/ui';
import { getTheme, setTheme, type ThemePreference } from '../theme';

export function SettingsView() {
  const { store, toaster, speech, assistant } = useApp();
  const [clearing, setClearing] = useState(false);
  const [theme, setThemeState] = useState<ThemePreference>(getTheme());
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    assistant.status().then((s) => setAiConfigured(s.configured));
  }, [assistant]);
  const counts = {
    tasks: store.tasks.value.length,
    notes: store.notes.value.length,
    projects: store.projects.value.length,
    research: store.research.value.length,
  };

  const exportJson = () => {
    const blob = new Blob([serializeWorkspace(store.snapshot())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spatialdesk-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toaster.show('success', 'Export downloaded');
  };
  const importJson = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toaster.show('error', 'That file is too large to import (20 MB limit).');
      return;
    }
    try {
      const payload: unknown = JSON.parse(await file.text());
      const summary = store.importData(payload, importMode);
      toaster.show(
        'success',
        `Imported ${summary.tasks} tasks, ${summary.notes} notes, ${summary.projects} projects, ${summary.research} research items${summary.dropped ? ` (${summary.dropped} skipped)` : ''}.`,
      );
    } catch {
      toaster.show('error', 'That file is not a valid SpatialDesk export.');
    }
  };

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <h1>Settings</h1>
          <span class="muted small">Appearance, data and privacy</span>
        </div>
      </div>
      <div class="stack" style={{ maxWidth: 720 }}>
        <section class="card stack">
          <h2>Appearance</h2>
          <Field label="Theme" id="theme">
            <select
              id="theme"
              class="select"
              value={theme}
              onChange={(e) => {
                const v = e.currentTarget.value as ThemePreference;
                setTheme(v);
                setThemeState(v);
              }}
            >
              <option value="system">Match system</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>
        </section>

        <section class="card stack">
          <h2>Your data</h2>
          <p class="small muted">
            SpatialDesk stores everything in this browser's local storage on this device (
            {store.storage.kind === 'local'
              ? 'enabled'
              : 'unavailable, using memory only for this session'}
            ). Nothing is synced to a server. Clearing site data in the browser also clears this
            workspace, so export a backup if you care about it.
          </p>
          <p class="small" data-testid="data-counts">
            {counts.tasks} tasks · {counts.notes} notes · {counts.projects} projects ·{' '}
            {counts.research} research items
            {store.lastSavedAt.value
              ? ` · last saved ${new Date(store.lastSavedAt.value).toLocaleTimeString()}`
              : ''}
          </p>
          {store.loadReport.value?.dropped ? (
            <Banner tone="warning">
              {store.loadReport.value.dropped} stored records could not be read and were skipped
              when loading.
            </Banner>
          ) : null}
          {store.lastError.value ? <Banner tone="error">{store.lastError.value}</Banner> : null}
          <div class="row">
            <Button onClick={exportJson} data-testid="export">
              Export JSON
            </Button>
            <select
              class="select"
              aria-label="Import mode"
              value={importMode}
              onChange={(e) => setImportMode(e.currentTarget.value as 'merge' | 'replace')}
              style={{ width: 'auto' }}
            >
              <option value="merge">Merge into current data</option>
              <option value="replace">Replace current data</option>
            </select>
            <Button onClick={() => fileRef.current?.click()} data-testid="import">
              Import JSON…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              class="sr-only"
              aria-label="Import file"
              data-testid="import-file"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) importJson(f);
                e.currentTarget.value = '';
              }}
            />
          </div>
          <div class="row">
            <Button variant="danger" onClick={() => setClearing(true)} data-testid="clear-all">
              Delete all data
            </Button>
          </div>
        </section>

        <section class="card stack">
          <h2>Privacy</h2>
          <ul class="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <strong>Local first.</strong> Tasks, notes, projects and research never leave this
              device unless you use the assistant or export them.
            </li>
            <li>
              <strong>AI assistant.</strong>{' '}
              {aiConfigured === null
                ? 'Checking…'
                : aiConfigured
                  ? 'Configured. When you press an assistant button, only the material shown on screen for that action is sent to the SpatialDesk server, which forwards it to Anthropic for processing. Nothing is sent automatically.'
                  : 'Not configured on this server, so no material is ever sent to an AI provider.'}
            </li>
            <li>
              <strong>Voice.</strong>{' '}
              {speech.available
                ? `Uses the browser's ${speech.name}. The browser may send audio to its vendor for recognition. The microphone is only active while the voice dialog shows “Listening”, and SpatialDesk never records or stores audio.`
                : `Not available here: ${speech.unavailableReason ?? 'unsupported'}.`}
            </li>
            <li>
              <strong>Immersive mode.</strong> Hand and controller poses are processed on the device
              by the browser's WebXR implementation and are not sent anywhere.
            </li>
          </ul>
        </section>
      </div>
      <ConfirmDialog
        open={clearing}
        title="Delete all data?"
        message="Every task, note, project and research item on this device will be permanently deleted. Export first if you want a backup."
        confirmLabel="Delete everything"
        danger
        onConfirm={() => {
          store.clearAll();
          setClearing(false);
          toaster.show('info', 'Workspace cleared');
        }}
        onCancel={() => setClearing(false)}
      />
    </>
  );
}
