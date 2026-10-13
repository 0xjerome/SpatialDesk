import { useEffect, useRef, useState } from 'preact/hooks';
import { AssistError, friendlyAssistMessage, type AssistantStatus } from '../../ai/client';
import type { OrganizeTasksResult, SummarizeResult } from '../../ai/schemas';
import { useApp } from '../context';
import { Badge, Banner, Button, Field, SparkIcon, formatDate } from '../components/ui';

export function AssistantView() {
  const { store, assistant, toaster, speech, voiceOpen } = useApp();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [busy, setBusy] = useState<'organize' | 'summarize' | null>(null);
  const [organized, setOrganized] = useState<OrganizeTasksResult | null>(null);
  const [text, setText] = useState('');
  const [summary, setSummary] = useState<SummarizeResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const openTasks = store.openTasks.value;

  useEffect(() => {
    const controller = new AbortController();
    assistant.status(controller.signal).then(setStatus);
    return () => {
      controller.abort();
      abortRef.current?.abort();
    };
  }, [assistant]);

  const run = async <T,>(
    kind: 'organize' | 'summarize',
    fn: (signal: AbortSignal) => Promise<T>,
    done: (v: T) => void,
  ) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setBusy(kind);
    try {
      done(await fn(abortRef.current.signal));
    } catch (e) {
      if (!(e instanceof AssistError && e.code === 'cancelled'))
        toaster.show('error', friendlyAssistMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const cancel = () => abortRef.current?.abort();
  const applySuggestion = (s: OrganizeTasksResult['suggestions'][number]) => {
    const patch: { priority?: 'low' | 'medium' | 'high'; dueDate?: string | null } = {};
    if (s.priority) patch.priority = s.priority;
    if (s.dueDate) patch.dueDate = s.dueDate;
    const r = store.updateTask(s.taskId, patch);
    if (r.ok) {
      toaster.show('success', `Updated "${r.value.title}"`);
      setOrganized((cur) =>
        cur ? { ...cur, suggestions: cur.suggestions.filter((x) => x !== s) } : cur,
      );
    } else toaster.show('error', Object.values(r.errors)[0] ?? 'Could not apply');
  };
  const saveSummaryAsNote = () => {
    if (!summary) return;
    const body = [
      summary.summary,
      summary.keyPoints.length ? `\nKey points:\n- ${summary.keyPoints.join('\n- ')}` : '',
      summary.actionItems.length ? `\nAction items:\n- ${summary.actionItems.join('\n- ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const r = store.createNote({ title: 'Summary', body });
    if (r.ok) toaster.show('success', 'Summary saved as a note');
  };
  const disabled = !status?.configured;

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <h1>Assistant</h1>
          <span class="muted small">
            Suggestions are generated from your own material and are never saved without your
            say-so.
          </span>
        </div>
        <div class="topbar-actions">
          {speech.available ? (
            <Button onClick={() => (voiceOpen.value = true)}>Voice command</Button>
          ) : null}
        </div>
      </div>

      {status === null ? (
        <Banner tone="info" testId="ai-status">
          Checking assistant availability…
        </Banner>
      ) : status.unreachable ? (
        <Banner tone="warning" testId="ai-status">
          The assistant server could not be reached. The rest of SpatialDesk keeps working offline;
          start the server (<code class="mono">npm run dev:server</code>) to enable AI features.
        </Banner>
      ) : !status.configured ? (
        <Banner tone="warning" testId="ai-status">
          <span>
            <strong>AI assistant not configured.</strong> The server has no{' '}
            <code class="mono">ANTHROPIC_API_KEY</code>, so AI features are switched off. Add the
            key to <code class="mono">.env</code> on the server and restart it. No data leaves your
            device until then.
          </span>
        </Banner>
      ) : (
        <Banner tone="success" testId="ai-status">
          Assistant ready · provider {status.provider} · model{' '}
          <span class="mono">{status.model}</span>. Material you send is processed by the provider;
          see Settings for details.
        </Banner>
      )}

      <div class="split" style={{ marginTop: 24 }}>
        <section class="card stack">
          <h2 class="row">
            <SparkIcon /> Organise my tasks
          </h2>
          <p class="small muted">
            Groups your {openTasks.length} open tasks by theme and suggests priority or due-date
            changes you can apply one by one.
          </p>
          <div class="row">
            <Button
              variant="primary"
              busy={busy === 'organize'}
              disabled={disabled || openTasks.length === 0}
              onClick={() =>
                run(
                  'organize',
                  (s) => assistant.organizeTasks(openTasks, s),
                  (r) => setOrganized(r.result),
                )
              }
              data-testid="ai-organize"
            >
              Organise tasks
            </Button>
            {busy === 'organize' ? (
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
          </div>
          {openTasks.length === 0 ? <p class="small faint">Add some open tasks first.</p> : null}
          {organized ? (
            <div class="stack" data-testid="ai-organize-result">
              {organized.groups.map((g) => (
                <div key={g.name} class="suggestion stack" style={{ gap: 4 }}>
                  <strong>{g.name}</strong>
                  {g.rationale ? <span class="small muted">{g.rationale}</span> : null}
                  <ul class="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {g.taskIds.map((id) => (
                      <li key={id}>{store.getTask(id)?.title ?? id}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {organized.suggestions.length > 0 ? (
                <h3>Suggested changes</h3>
              ) : (
                <p class="small muted">No changes suggested.</p>
              )}
              {organized.suggestions.map((s) => {
                const task = store.getTask(s.taskId);
                if (!task) return null;
                return (
                  <div
                    key={`${s.taskId}-${s.priority}-${s.dueDate}`}
                    class="card row row-between"
                    style={{ padding: 12 }}
                  >
                    <div class="stack" style={{ gap: 2 }}>
                      <strong class="small">{task.title}</strong>
                      <span class="small muted">
                        {s.priority ? <Badge tone={s.priority}>{s.priority}</Badge> : null}{' '}
                        {s.dueDate ? `due ${formatDate(s.dueDate)}` : ''}{' '}
                        {s.reason ? `· ${s.reason}` : ''}
                      </span>
                    </div>
                    <Button class="btn-sm" onClick={() => applySuggestion(s)}>
                      Apply
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        <section class="card stack">
          <h2 class="row">
            <SparkIcon /> Summarise material
          </h2>
          <Field
            label="Paste text to summarise"
            id="ai-text"
            hint={`${text.length.toLocaleString()} / ${(status?.maxInputChars || 60_000).toLocaleString()} characters`}
          >
            <textarea
              id="ai-text"
              class="textarea"
              value={text}
              maxLength={status?.maxInputChars || 60_000}
              onInput={(e) => setText(e.currentTarget.value)}
              placeholder="Meeting transcript, article excerpt, long email…"
            />
          </Field>
          <div class="row">
            <Button
              variant="primary"
              busy={busy === 'summarize'}
              disabled={disabled || text.trim().length < 20}
              onClick={() =>
                run(
                  'summarize',
                  (s) => assistant.summarize('', text, s),
                  (r) => setSummary(r.result),
                )
              }
              data-testid="ai-summarize"
            >
              Summarise
            </Button>
            {busy === 'summarize' ? (
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
          </div>
          {summary ? (
            <div class="suggestion stack" data-testid="ai-summary-result">
              <p>{summary.summary}</p>
              {summary.keyPoints.length ? (
                <ul class="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {summary.keyPoints.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              ) : null}
              {summary.actionItems.length ? (
                <div class="stack" style={{ gap: 6 }}>
                  <strong class="small">Action items</strong>
                  {summary.actionItems.map((a) => (
                    <div key={a} class="row row-between small">
                      <span>{a}</span>
                      <Button
                        class="btn-sm"
                        onClick={() => {
                          const r = store.createTask({ title: a });
                          if (r.ok) toaster.show('success', `Task "${r.value.title}" created`);
                        }}
                      >
                        Add task
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div class="row">
                <Button class="btn-sm" onClick={saveSummaryAsNote}>
                  Save as note
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
