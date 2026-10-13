import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Note } from '../../domain/types';
import { searchNotes } from '../../domain/queries';
import { useApp } from '../context';
import { AssistError, friendlyAssistMessage } from '../../ai/client';
import type { DraftedTask } from '../../ai/schemas';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  NoteIcon,
  PlusIcon,
  SearchInput,
  SparkIcon,
  formatRelative,
} from '../components/ui';

export function NotesView(props: { noteId: string | null; initialQuery?: string }) {
  const { store, router, toaster } = useApp();
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [projectId, setProjectId] = useState<string>('all');
  const notes = store.notes.value;
  const visible = useMemo(() => searchNotes(notes, query, projectId), [notes, query, projectId]);
  const selected = props.noteId ? store.getNote(props.noteId) : undefined;

  const createNote = () => {
    const r = store.createNote({
      title: 'Untitled note',
      body: '',
      projectId: projectId !== 'all' ? projectId : null,
    });
    if (r.ok) router.navigate('notes', r.value.id);
    else toaster.show('error', Object.values(r.errors)[0] ?? 'Could not create note');
  };

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <h1>Notes</h1>
          <span class="muted small">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </span>
        </div>
        <div class="topbar-actions">
          <Button variant="primary" icon={<PlusIcon />} onClick={createNote} data-testid="new-note">
            New note
          </Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <EmptyState
          icon={<NoteIcon />}
          title="No notes yet"
          body="Write down meeting notes, ideas and references. Notes save as you type and can be turned into tasks with the assistant."
          action={
            <Button variant="primary" icon={<PlusIcon />} onClick={createNote}>
              Write your first note
            </Button>
          }
        />
      ) : (
        <div class="split">
          <div class="stack">
            <div class="toolbar" style={{ marginBottom: 0 }}>
              <SearchInput
                value={query}
                onInput={setQuery}
                label="Search notes"
                placeholder="Search notes"
                id="note-search"
              />
              {store.projects.value.length > 0 ? (
                <select
                  class="select"
                  aria-label="Filter notes by project"
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
            {visible.length === 0 ? (
              <p class="muted">No notes match “{query}”.</p>
            ) : (
              <ul class="list" aria-label="Notes">
                {visible.map((n) => (
                  <li
                    key={n.id}
                    class="item"
                    data-testid="note-item"
                    style={{ borderColor: n.id === selected?.id ? 'var(--accent)' : undefined }}
                  >
                    <div class="item-main">
                      <a
                        href={`#/notes/${encodeURIComponent(n.id)}`}
                        class="item-title truncate"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                        aria-current={n.id === selected?.id ? 'true' : undefined}
                      >
                        {n.title || 'Untitled note'}
                      </a>
                      <p class="small muted truncate">{n.body.split('\n')[0] || 'Empty note'}</p>
                      <span class="small faint">Edited {formatRelative(n.updatedAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            {selected ? (
              <NoteEditor key={selected.id} note={selected} />
            ) : (
              <div class="pane">
                <p class="muted">Select a note to read or edit it.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function NoteEditor(props: { note: Note }) {
  const { store, router, toaster, assistant } = useApp();
  const [title, setTitle] = useState(props.note.title);
  const [body, setBody] = useState(props.note.body);
  const [projectId, setProjectId] = useState(props.note.projectId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedState, setSavedState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [deleting, setDeleting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<DraftedTask[] | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const persist = (next: { title: string; body: string; projectId: string }) => {
    setSavedState('saving');
    const r = store.updateNote(props.note.id, {
      title: next.title,
      body: next.body,
      projectId: next.projectId || null,
    });
    if (r.ok) {
      setError(null);
      setSavedState('saved');
    } else {
      setError(Object.values(r.errors)[0] ?? 'Could not save');
      setSavedState('unsaved');
    }
  };
  const schedule = (next: { title: string; body: string; projectId: string }) => {
    setSavedState('unsaved');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(next), 400);
  };
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      abortRef.current?.abort();
    },
    [],
  );
  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (savedState !== 'unsaved') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [savedState]);

  const deleteNote = () => {
    const snapshot = props.note;
    store.deleteNote(snapshot.id);
    setDeleting(false);
    toaster.show('info', `Deleted "${snapshot.title}"`, {
      label: 'Undo',
      run: () => store.importData({ notes: [snapshot] }, 'merge'),
    });
    router.navigate('notes');
  };

  const draftTasks = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      persist({ title, body, projectId });
    }
    setDrafting(true);
    abortRef.current = new AbortController();
    try {
      const r = await assistant.draftTasksFromNote({ title, body }, abortRef.current.signal);
      setDrafts(r.result.tasks);
      setDraftNote(r.result.note);
    } catch (e) {
      if (e instanceof AssistError && e.code === 'cancelled') return;
      toaster.show('error', friendlyAssistMessage(e));
    } finally {
      setDrafting(false);
    }
  };
  const acceptDraft = (d: DraftedTask) => {
    const r = store.createTask({ ...d, projectId: projectId || null });
    if (r.ok) {
      toaster.show('success', `Task "${r.value.title}" created`);
      setDrafts((cur) => cur?.filter((x) => x !== d) ?? null);
    } else toaster.show('error', Object.values(r.errors)[0] ?? 'Could not create task');
  };

  return (
    <div class="pane stack" data-testid="note-editor">
      <div class="row row-between">
        <span class="small muted" aria-live="polite" data-testid="note-save-state">
          {savedState === 'saved'
            ? 'Saved'
            : savedState === 'saving'
              ? 'Saving…'
              : 'Unsaved changes'}
        </span>
        <div class="row">
          <Button
            class="btn-sm"
            icon={<SparkIcon />}
            busy={drafting}
            onClick={draftTasks}
            disabled={body.trim() === '' && title.trim() === ''}
            data-testid="note-draft-tasks"
          >
            Draft tasks
          </Button>
          <Button
            class="btn-sm"
            variant="danger"
            onClick={() => setDeleting(true)}
            data-testid="note-delete"
          >
            Delete
          </Button>
        </div>
      </div>
      <Field label="Title" id="note-title" error={error ?? undefined}>
        <input
          id="note-title"
          class="input"
          value={title}
          maxLength={200}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setTitle(v);
            schedule({ title: v, body, projectId });
          }}
        />
      </Field>
      <Field label="Project" id="note-project">
        <select
          id="note-project"
          class="select"
          value={projectId}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setProjectId(v);
            persist({ title, body, projectId: v });
          }}
        >
          <option value="">No project</option>
          {store.projects.value.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Body"
        id="note-body"
        hint={`${body.length.toLocaleString()} / 50,000 characters`}
      >
        <textarea
          id="note-body"
          class="textarea textarea-lg note-body"
          value={body}
          maxLength={50_000}
          placeholder="Start writing…"
          onInput={(e) => {
            const v = e.currentTarget.value;
            setBody(v);
            schedule({ title, body: v, projectId });
          }}
        />
      </Field>
      <ConfirmDialog
        open={deleting}
        title="Delete note?"
        message={`"${title || 'Untitled note'}" will be removed. Research items linked to it keep their own content.`}
        confirmLabel="Delete"
        danger
        onConfirm={deleteNote}
        onCancel={() => setDeleting(false)}
      />
      <Dialog
        open={drafts !== null}
        title="Suggested tasks"
        onClose={() => setDrafts(null)}
        testId="draft-dialog"
      >
        <p class="ai-mark">
          <SparkIcon /> Generated from this note. Nothing is saved until you add it.
        </p>
        {drafts && drafts.length === 0 ? (
          <p class="muted">{draftNote || 'The assistant found nothing actionable in this note.'}</p>
        ) : null}
        {drafts?.map((d) => (
          <div key={d.title} class="card suggestion stack" style={{ gap: 6 }}>
            <strong>{d.title}</strong>
            {d.description ? <p class="small muted">{d.description}</p> : null}
            <div class="row small muted">
              <span>Priority: {d.priority}</span>
              {d.dueDate ? <span>Due {d.dueDate}</span> : null}
              <Button
                class="btn-sm"
                variant="primary"
                onClick={() => acceptDraft(d)}
                style={{ marginLeft: 'auto' }}
              >
                Add task
              </Button>
            </div>
          </div>
        ))}
      </Dialog>
    </div>
  );
}
