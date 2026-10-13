import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ResearchItem } from '../../domain/types';
import { collectTags, searchResearch } from '../../domain/queries';
import { parseTagInput, type FieldErrors } from '../../domain/validation';
import { AssistError, friendlyAssistMessage } from '../../ai/client';
import type { SummarizeResult } from '../../ai/schemas';
import { useApp } from '../context';
import {
  BookIcon,
  Button,
  ConfirmDialog,
  Dialog,
  EditIcon,
  EmptyState,
  Field,
  LinkIcon,
  PlusIcon,
  SearchInput,
  SparkIcon,
  TrashIcon,
  formatRelative,
} from '../components/ui';

export function ResearchView(props: { initialQuery?: string }) {
  const { store, toaster } = useApp();
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [tag, setTag] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResearchItem | null>(null);
  const [deleting, setDeleting] = useState<ResearchItem | null>(null);
  const items = store.research.value;
  const tags = useMemo(() => collectTags(items), [items]);
  const visible = useMemo(
    () => searchResearch(items, query, { projectId, tag }),
    [items, query, projectId, tag],
  );

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <h1>Research</h1>
          <span class="muted small">Links, sources and summaries you want to keep</span>
        </div>
        <div class="topbar-actions">
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="new-research"
          >
            Save research
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<BookIcon />}
          title="No research saved"
          body="Keep links, papers and references with your own summary and tags. SpatialDesk stores what you write; it never invents a summary for a page it has not read."
          action={
            <Button
              variant="primary"
              icon={<PlusIcon />}
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              Save your first source
            </Button>
          }
        />
      ) : (
        <>
          <div class="toolbar" role="search">
            <SearchInput
              value={query}
              onInput={setQuery}
              label="Search research"
              placeholder="Search titles, links, tags"
              id="research-search"
            />
            {store.projects.value.length > 0 ? (
              <select
                class="select"
                aria-label="Filter research by project"
                value={projectId}
                onChange={(e) => setProjectId(e.currentTarget.value)}
              >
                <option value="all">Any project</option>
                {store.projects.value.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {tags.length > 0 ? (
            <div class="tag-row" style={{ marginBottom: 16 }} aria-label="Filter by tag">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  class="tag"
                  aria-pressed={tag === t}
                  onClick={() => setTag(tag === t ? null : t)}
                >
                  #{t}
                </button>
              ))}
            </div>
          ) : null}
          {visible.length === 0 ? (
            <EmptyState
              title="Nothing matches"
              body="Try another search or tag."
              action={
                <Button
                  onClick={() => {
                    setQuery('');
                    setTag(null);
                    setProjectId('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ul class="list" aria-label="Research items">
              {visible.map((r) => {
                const project = r.projectId ? store.getProject(r.projectId) : undefined;
                const note = r.noteId ? store.getNote(r.noteId) : undefined;
                return (
                  <li key={r.id} class="item" data-testid="research-item">
                    <div class="item-main">
                      <span class="item-title">{r.title}</span>
                      {r.url ? (
                        <a
                          class="small truncate row"
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ gap: 4 }}
                        >
                          <LinkIcon /> {r.url}
                        </a>
                      ) : null}
                      {r.summary ? (
                        <p
                          class="small muted prewrap"
                          style={{ maxHeight: 72, overflow: 'hidden' }}
                        >
                          {r.summary}
                        </p>
                      ) : null}
                      <div class="item-meta">
                        {r.tags.map((t) => (
                          <span key={t} class="tag">
                            #{t}
                          </span>
                        ))}
                        {project ? (
                          <span class="row small">
                            <span class={`dot dot-${project.color}`} aria-hidden="true" />
                            {project.name}
                          </span>
                        ) : null}
                        {note ? (
                          <a class="small" href={`#/notes/${encodeURIComponent(note.id)}`}>
                            Note: {note.title}
                          </a>
                        ) : null}
                        <span class="faint">Saved {formatRelative(r.createdAt)}</span>
                      </div>
                    </div>
                    <div class="item-actions">
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={`Edit ${r.title}`}
                        onClick={() => {
                          setEditing(r);
                          setDialogOpen(true);
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={`Delete ${r.title}`}
                        onClick={() => setDeleting(r)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <ResearchDialog open={dialogOpen} item={editing} onClose={() => setDialogOpen(false)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete research item?"
        message={deleting ? `"${deleting.title}" will be removed.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleting) {
            const snapshot = deleting;
            store.deleteResearch(snapshot.id);
            toaster.show('info', `Deleted "${snapshot.title}"`, {
              label: 'Undo',
              run: () => store.importData({ research: [snapshot] }, 'merge'),
            });
          }
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

export function ResearchDialog(props: {
  open: boolean;
  item: ResearchItem | null;
  onClose: () => void;
  initialNoteId?: string | null;
}) {
  const { store, toaster, assistant } = useApp();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [projectId, setProjectId] = useState('');
  const [noteId, setNoteId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summarizing, setSummarizing] = useState(false);
  const [aiSummary, setAiSummary] = useState<SummarizeResult | null>(null);
  useEffect(() => {
    if (!props.open) return;
    setTitle(props.item?.title ?? '');
    setUrl(props.item?.url ?? '');
    setSummary(props.item?.summary ?? '');
    setTagsText(props.item?.tags.join(', ') ?? '');
    setProjectId(props.item?.projectId ?? '');
    setNoteId(props.item?.noteId ?? props.initialNoteId ?? '');
    setErrors({});
    setAiSummary(null);
  }, [props.open, props.item, props.initialNoteId]);
  const submit = (e: Event) => {
    e.preventDefault();
    const input = {
      title,
      url: url || null,
      summary,
      tags: parseTagInput(tagsText),
      projectId: projectId || null,
      noteId: noteId || null,
    };
    const r = props.item ? store.updateResearch(props.item.id, input) : store.createResearch(input);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    toaster.show('success', props.item ? 'Research updated' : 'Research saved');
    props.onClose();
  };
  const condense = async () => {
    setSummarizing(true);
    try {
      const r = await assistant.summarize(title, summary);
      setAiSummary(r.result);
    } catch (e) {
      if (!(e instanceof AssistError && e.code === 'cancelled'))
        toaster.show('error', friendlyAssistMessage(e));
    } finally {
      setSummarizing(false);
    }
  };
  return (
    <Dialog
      open={props.open}
      title={props.item ? 'Edit research' : 'Save research'}
      onClose={props.onClose}
      testId="research-dialog"
      wide
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="research-form" data-testid="research-save">
            {props.item ? 'Save changes' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="research-form" class="stack" onSubmit={submit} noValidate>
        <Field label="Title" id="research-title" error={errors.title} required>
          <input
            id="research-title"
            class="input"
            value={title}
            maxLength={200}
            autoFocus
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
        </Field>
        <Field
          label="Link"
          id="research-url"
          error={errors.url}
          hint="Optional. http or https only; the page is not fetched."
        >
          <input
            id="research-url"
            class="input"
            type="url"
            inputMode="url"
            value={url}
            placeholder="https://"
            onInput={(e) => setUrl(e.currentTarget.value)}
          />
        </Field>
        <Field
          label="Your notes or pasted excerpt"
          id="research-summary"
          error={errors.summary}
          hint="Paste the relevant passage and the assistant can condense it for you."
        >
          <textarea
            id="research-summary"
            class="textarea"
            value={summary}
            maxLength={4000}
            onInput={(e) => setSummary(e.currentTarget.value)}
          />
        </Field>
        <div class="row">
          <Button
            class="btn-sm"
            icon={<SparkIcon />}
            busy={summarizing}
            disabled={summary.trim().length < 40}
            onClick={condense}
            data-testid="research-condense"
          >
            Condense with assistant
          </Button>
          <span class="small faint">Works on the text above only.</span>
        </div>
        {aiSummary ? (
          <div class="card suggestion stack" style={{ gap: 6 }}>
            <span class="ai-mark">
              <SparkIcon /> Suggested summary
            </span>
            <p class="small">{aiSummary.summary}</p>
            {aiSummary.keyPoints.length ? (
              <ul class="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                {aiSummary.keyPoints.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            ) : null}
            <div class="row">
              <Button
                class="btn-sm"
                variant="primary"
                onClick={() => {
                  setSummary(
                    aiSummary.summary +
                      (aiSummary.keyPoints.length
                        ? `\n\n- ${aiSummary.keyPoints.join('\n- ')}`
                        : ''),
                  );
                  setAiSummary(null);
                }}
              >
                Use this summary
              </Button>
              <Button class="btn-sm" variant="ghost" onClick={() => setAiSummary(null)}>
                Discard
              </Button>
            </div>
          </div>
        ) : null}
        <div class="form-grid">
          <Field label="Tags" id="research-tags" hint="Comma separated">
            <input
              id="research-tags"
              class="input"
              value={tagsText}
              onInput={(e) => setTagsText(e.currentTarget.value)}
              placeholder="webxr, hands"
            />
          </Field>
          <Field label="Project" id="research-project" error={errors.projectId}>
            <select
              id="research-project"
              class="select"
              value={projectId}
              onChange={(e) => setProjectId(e.currentTarget.value)}
            >
              <option value="">No project</option>
              {store.projects.value.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Related note" id="research-note" error={errors.noteId}>
            <select
              id="research-note"
              class="select"
              value={noteId}
              onChange={(e) => setNoteId(e.currentTarget.value)}
            >
              <option value="">None</option>
              {store.notes.value.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
