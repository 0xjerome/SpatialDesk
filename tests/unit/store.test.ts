import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorageAdapter, loadWorkspace } from '../../src/domain/persistence';
import { WorkspaceStore } from '../../src/domain/store';

function makeStore(storage = new MemoryStorageAdapter()) {
  return new WorkspaceStore({ storage, saveDelayMs: 0 });
}

describe('WorkspaceStore tasks', () => {
  let store: WorkspaceStore;
  beforeEach(() => {
    store = makeStore();
  });

  it('creates, completes, reopens and deletes a task', () => {
    const created = store.createTask({ title: 'Write tests', priority: 'high' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(store.tasks.value).toHaveLength(1);
    expect(store.openTasks.value).toHaveLength(1);

    const done = store.toggleTaskDone(created.value.id);
    expect(done.ok && done.value.status).toBe('done');
    expect(done.ok && done.value.completedAt).not.toBeNull();
    expect(store.openTasks.value).toHaveLength(0);

    const reopened = store.toggleTaskDone(created.value.id);
    expect(reopened.ok && reopened.value.status).toBe('todo');
    expect(reopened.ok && reopened.value.completedAt).toBeNull();

    expect(store.deleteTask(created.value.id)).toBe(true);
    expect(store.deleteTask(created.value.id)).toBe(false);
    expect(store.tasks.value).toHaveLength(0);
  });

  it('returns validation errors without mutating state', () => {
    const r = store.createTask({ title: '' });
    expect(r.ok).toBe(false);
    expect(store.tasks.value).toHaveLength(0);
  });

  it('rejects links to missing projects', () => {
    const r = store.createTask({ title: 'x', projectId: 'missing' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.projectId).toBeDefined();
  });

  it('partially updates a task', () => {
    const t = store.createTask({ title: 'a', description: 'd', dueDate: '2026-03-01' });
    if (!t.ok) throw new Error('setup');
    const u = store.updateTask(t.value.id, { title: 'b' });
    expect(u.ok && u.value).toMatchObject({ title: 'b', description: 'd', dueDate: '2026-03-01' });
    const cleared = store.updateTask(t.value.id, { dueDate: null });
    expect(cleared.ok && cleared.value.dueDate).toBeNull();
  });
});

describe('WorkspaceStore relationships', () => {
  it('detaches tasks, notes and research when a project is deleted', () => {
    const store = makeStore();
    const p = store.createProject({ name: 'Launch' });
    if (!p.ok) throw new Error('setup');
    const t = store.createTask({ title: 't', projectId: p.value.id });
    const n = store.createNote({ title: 'n', projectId: p.value.id });
    if (!t.ok || !n.ok) throw new Error('setup');
    const r = store.createResearch({ title: 'r', projectId: p.value.id, noteId: n.value.id });
    if (!r.ok) throw new Error('setup');

    expect(store.deleteProject(p.value.id)).toBe(true);
    expect(store.getTask(t.value.id)?.projectId).toBeNull();
    expect(store.getNote(n.value.id)?.projectId).toBeNull();
    expect(store.getResearch(r.value.id)?.projectId).toBeNull();
    expect(store.getResearch(r.value.id)?.noteId).toBe(n.value.id);
  });

  it('cascades when asked', () => {
    const store = makeStore();
    const p = store.createProject({ name: 'Launch' });
    if (!p.ok) throw new Error('setup');
    store.createTask({ title: 'keep' });
    store.createTask({ title: 'gone', projectId: p.value.id });
    store.deleteProject(p.value.id, { cascade: true });
    expect(store.tasks.value.map((t) => t.title)).toEqual(['keep']);
  });

  it('clears note links on research when a note is deleted', () => {
    const store = makeStore();
    const n = store.createNote({ title: 'n' });
    if (!n.ok) throw new Error('setup');
    const r = store.createResearch({ title: 'r', noteId: n.value.id });
    if (!r.ok) throw new Error('setup');
    store.deleteNote(n.value.id);
    expect(store.getResearch(r.value.id)?.noteId).toBeNull();
  });
});

describe('WorkspaceStore persistence', () => {
  it('round-trips through storage', () => {
    const storage = new MemoryStorageAdapter();
    const a = makeStore(storage);
    const p = a.createProject({ name: 'P', color: 'teal' });
    if (!p.ok) throw new Error('setup');
    a.createTask({ title: 'persisted', projectId: p.value.id, dueDate: '2026-05-05' });
    a.createNote({ title: 'note', body: 'hello\nworld' });
    a.createResearch({ title: 'src', url: 'example.com', tags: ['x'] });

    const b = makeStore(storage);
    expect(b.tasks.value[0]).toMatchObject({
      title: 'persisted',
      projectId: p.value.id,
      dueDate: '2026-05-05',
    });
    expect(b.notes.value[0]?.body).toBe('hello\nworld');
    expect(b.research.value[0]?.url).toBe('https://example.com/');
    expect(b.projects.value[0]?.color).toBe('teal');
    expect(b.loadReport.value?.fresh).toBe(false);
  });

  it('survives corrupt storage and reports it', () => {
    const storage = new MemoryStorageAdapter();
    storage.write('{not json');
    const store = makeStore(storage);
    expect(store.status.value).toBe('error');
    expect(store.lastError.value).toMatch(/could not be read/);
    expect(store.tasks.value).toHaveLength(0);
    // A new write recovers.
    store.createTask({ title: 'recover' });
    expect(store.status.value).toBe('ready');
    expect(loadWorkspace(storage).data.tasks).toHaveLength(1);
  });

  it('drops corrupt records but keeps the rest', () => {
    const storage = new MemoryStorageAdapter();
    storage.write(
      JSON.stringify({
        schemaVersion: 1,
        savedAt: '',
        data: {
          tasks: [{ id: 't1', title: 'good' }, { id: 't2' }, 'junk'],
          projects: [{ id: 'p1', name: 'P' }],
          notes: [{ id: 'n1', title: 'N', projectId: 'missing' }],
          research: [{ id: 'r1', title: 'R', url: 'javascript:bad' }],
        },
      }),
    );
    const store = makeStore(storage);
    expect(store.tasks.value.map((t) => t.id)).toEqual(['t1']);
    expect(store.loadReport.value?.dropped).toBe(3);
    expect(store.notes.value[0]?.projectId).toBeNull();
  });

  it('migrates a v0 payload without an envelope', () => {
    const storage = new MemoryStorageAdapter();
    storage.write(JSON.stringify({ tasks: [{ id: 'a', title: 'legacy' }] }));
    const store = makeStore(storage);
    expect(store.tasks.value[0]?.title).toBe('legacy');
  });

  it('imports with replace and merge semantics', () => {
    const store = makeStore();
    store.createTask({ title: 'existing' });
    const summary = store.importData({ tasks: [{ id: 'imp', title: 'imported' }] }, 'merge');
    expect(summary.tasks).toBe(1);
    expect(store.tasks.value).toHaveLength(2);
    store.importData({ tasks: [{ id: 'imp', title: 'imported' }] }, 'replace');
    expect(store.tasks.value).toHaveLength(1);
  });

  it('clearAll removes everything and persists the empty state', () => {
    const storage = new MemoryStorageAdapter();
    const store = makeStore(storage);
    store.createTask({ title: 'x' });
    store.clearAll();
    expect(store.isEmpty).toBe(true);
    expect(loadWorkspace(storage).data.tasks).toHaveLength(0);
  });
});
