import { batch, computed, signal, type ReadonlySignal } from '@preact/signals-core';
import { createId, nowIso } from './ids';
import {
  createDefaultStorage,
  loadWorkspace,
  normalizeWorkspace,
  saveWorkspace,
  STORAGE_KEY,
  type LoadReport,
  type StorageAdapter,
} from './persistence';
import type { Note, Project, ResearchItem, Task, WorkspaceData } from './types';
import {
  validateNote,
  validateProject,
  validateResearch,
  validateTask,
  type NoteInput,
  type ProjectInput,
  type ResearchInput,
  type TaskInput,
  type ValidationResult,
} from './validation';

export interface StoreOptions {
  storage?: StorageAdapter;
  /** Reload when another browser tab writes the same storage key. Default true. */
  crossTab?: boolean;
  /** Delay before writing to storage, so rapid edits coalesce. 0 = synchronous. */
  saveDelayMs?: number;
  now?: () => string;
}

export type StoreStatus = 'loading' | 'ready' | 'error';

export interface ImportSummary {
  tasks: number;
  notes: number;
  projects: number;
  research: number;
  dropped: number;
}

/**
 * The single source of truth for workspace records. Both the browser UI and the
 * immersive workspace read the same signals, so a change made with a hand
 * pinch in XR is visible in the 2D panel the moment the session ends.
 */
export class WorkspaceStore {
  readonly tasks = signal<readonly Task[]>([]);
  readonly notes = signal<readonly Note[]>([]);
  readonly projects = signal<readonly Project[]>([]);
  readonly research = signal<readonly ResearchItem[]>([]);
  readonly status = signal<StoreStatus>('loading');
  readonly lastError = signal<string | null>(null);
  readonly lastSavedAt = signal<string | null>(null);
  readonly loadReport = signal<LoadReport | null>(null);
  /** Incremented when another tab wrote the workspace and this tab reloaded it. */
  readonly externalUpdates = signal(0);

  /** Open (not done) tasks, newest first. */
  readonly openTasks: ReadonlySignal<Task[]>;
  readonly storage: StorageAdapter;

  private readonly saveDelayMs: number;
  private readonly now: () => string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private detachCrossTab: (() => void) | null = null;

  constructor(options: StoreOptions = {}) {
    this.storage = options.storage ?? createDefaultStorage();
    this.saveDelayMs = options.saveDelayMs ?? 150;
    this.now = options.now ?? nowIso;
    this.openTasks = computed(() => this.tasks.value.filter((t) => t.status !== 'done'));
    this.load();
    if (options.crossTab !== false) this.attachCrossTabSync();
  }

  /**
   * Keep this tab in sync when another tab of the same origin saves the
   * workspace. Unsaved local edits are kept and win when they flush
   * (last writer wins); a tab with nothing pending simply reloads.
   */
  private attachCrossTabSync(): void {
    if (typeof window === 'undefined' || this.storage.kind !== 'local') return;
    const key = (this.storage as { key?: string }).key ?? STORAGE_KEY;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      if (this.dirty) return;
      this.load();
      this.externalUpdates.value += 1;
    };
    window.addEventListener('storage', onStorage);
    this.detachCrossTab = () => window.removeEventListener('storage', onStorage);
  }

  /** Remove listeners (tests and hot reload). */
  dispose(): void {
    this.detachCrossTab?.();
    this.detachCrossTab = null;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
  }

  /* ----------------------------- lifecycle ----------------------------- */

  load(): void {
    const report = loadWorkspace(this.storage);
    batch(() => {
      this.applyData(report.data);
      this.loadReport.value = report;
      this.lastError.value = report.error ?? null;
      this.status.value = report.error ? 'error' : 'ready';
    });
  }

  /** Flush any pending write immediately (used on page hide and in tests). */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    try {
      saveWorkspace(this.storage, this.snapshot());
      this.dirty = false;
      this.lastSavedAt.value = this.now();
      if (this.status.value === 'error') {
        this.status.value = 'ready';
        this.lastError.value = null;
      }
    } catch (error) {
      this.status.value = 'error';
      this.lastError.value = isQuotaError(error)
        ? "Changes could not be saved: this browser's storage is full. Export your workspace and delete what you no longer need."
        : `Changes could not be saved: ${(error as Error).message}`;
    }
  }

  snapshot(): WorkspaceData {
    return {
      tasks: [...this.tasks.value],
      notes: [...this.notes.value],
      projects: [...this.projects.value],
      research: [...this.research.value],
    };
  }

  /** Replace everything with an imported payload. Returns what was accepted. */
  importData(payload: unknown, mode: 'replace' | 'merge'): ImportSummary {
    const { data, dropped } = normalizeWorkspace(payload, this.now());
    batch(() => {
      if (mode === 'replace') {
        this.applyData(data);
      } else {
        const merge = <T extends { id: string }>(
          current: readonly T[],
          incoming: readonly T[],
        ): T[] => {
          const map = new Map(current.map((r) => [r.id, r]));
          for (const r of incoming) map.set(r.id, r);
          return [...map.values()];
        };
        this.projects.value = merge(this.projects.value, data.projects);
        this.notes.value = merge(this.notes.value, data.notes);
        this.tasks.value = merge(this.tasks.value, data.tasks);
        this.research.value = merge(this.research.value, data.research);
      }
    });
    this.markDirty();
    return {
      tasks: data.tasks.length,
      notes: data.notes.length,
      projects: data.projects.length,
      research: data.research.length,
      dropped,
    };
  }

  /** Permanently delete every record. Callers must confirm with the user first. */
  clearAll(): void {
    batch(() => this.applyData({ tasks: [], notes: [], projects: [], research: [] }));
    this.markDirty();
    this.flush();
  }

  get isEmpty(): boolean {
    return (
      this.tasks.value.length === 0 &&
      this.notes.value.length === 0 &&
      this.projects.value.length === 0 &&
      this.research.value.length === 0
    );
  }

  /* ------------------------------- tasks ------------------------------- */

  getTask(id: string): Task | undefined {
    return this.tasks.value.find((t) => t.id === id);
  }

  createTask(input: TaskInput): ValidationResult<Task> {
    const result = validateTask(input);
    if (!result.ok) return result;
    const err = this.checkRefs(result.value.projectId, null);
    if (err) return err;
    const now = this.now();
    const task: Task = {
      id: createId(),
      ...result.value,
      createdAt: now,
      updatedAt: now,
      completedAt: result.value.status === 'done' ? now : null,
    };
    this.tasks.value = [task, ...this.tasks.value];
    this.markDirty();
    return { ok: true, value: task };
  }

  updateTask(id: string, input: Partial<TaskInput>): ValidationResult<Task> {
    const existing = this.getTask(id);
    if (!existing) return { ok: false, errors: { id: 'Task no longer exists.' } };
    const result = validateTask({
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      status: input.status ?? existing.status,
      priority: input.priority ?? existing.priority,
      dueDate: input.dueDate === undefined ? existing.dueDate : input.dueDate,
      projectId: input.projectId === undefined ? existing.projectId : input.projectId,
    });
    if (!result.ok) return result;
    const err = this.checkRefs(result.value.projectId, null);
    if (err) return err;
    const now = this.now();
    const becameDone = result.value.status === 'done' && existing.status !== 'done';
    const updated: Task = {
      ...existing,
      ...result.value,
      updatedAt: now,
      completedAt:
        result.value.status === 'done' ? (becameDone ? now : (existing.completedAt ?? now)) : null,
    };
    this.tasks.value = this.tasks.value.map((t) => (t.id === id ? updated : t));
    this.markDirty();
    return { ok: true, value: updated };
  }

  /** Toggle between done and todo (or in_progress -> done). */
  toggleTaskDone(id: string): ValidationResult<Task> {
    const existing = this.getTask(id);
    if (!existing) return { ok: false, errors: { id: 'Task no longer exists.' } };
    return this.updateTask(id, { status: existing.status === 'done' ? 'todo' : 'done' });
  }

  deleteTask(id: string): boolean {
    const before = this.tasks.value.length;
    this.tasks.value = this.tasks.value.filter((t) => t.id !== id);
    const removed = this.tasks.value.length !== before;
    if (removed) this.markDirty();
    return removed;
  }

  /* ------------------------------- notes ------------------------------- */

  getNote(id: string): Note | undefined {
    return this.notes.value.find((n) => n.id === id);
  }

  createNote(input: NoteInput): ValidationResult<Note> {
    const result = validateNote(input);
    if (!result.ok) return result;
    const err = this.checkRefs(result.value.projectId, null);
    if (err) return err;
    const now = this.now();
    const note: Note = { id: createId(), ...result.value, createdAt: now, updatedAt: now };
    this.notes.value = [note, ...this.notes.value];
    this.markDirty();
    return { ok: true, value: note };
  }

  updateNote(id: string, input: Partial<NoteInput>): ValidationResult<Note> {
    const existing = this.getNote(id);
    if (!existing) return { ok: false, errors: { id: 'Note no longer exists.' } };
    const result = validateNote({
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
      projectId: input.projectId === undefined ? existing.projectId : input.projectId,
    });
    if (!result.ok) return result;
    const err = this.checkRefs(result.value.projectId, null);
    if (err) return err;
    const updated: Note = { ...existing, ...result.value, updatedAt: this.now() };
    this.notes.value = this.notes.value.map((n) => (n.id === id ? updated : n));
    this.markDirty();
    return { ok: true, value: updated };
  }

  deleteNote(id: string): boolean {
    const before = this.notes.value.length;
    batch(() => {
      this.notes.value = this.notes.value.filter((n) => n.id !== id);
      // Research items keep their own content; only the link to the note is cleared.
      this.research.value = this.research.value.map((r) =>
        r.noteId === id ? { ...r, noteId: null, updatedAt: this.now() } : r,
      );
    });
    const removed = this.notes.value.length !== before;
    if (removed) this.markDirty();
    return removed;
  }

  /* ------------------------------ projects ----------------------------- */

  getProject(id: string): Project | undefined {
    return this.projects.value.find((p) => p.id === id);
  }

  createProject(input: ProjectInput): ValidationResult<Project> {
    const result = validateProject(input);
    if (!result.ok) return result;
    const now = this.now();
    const project: Project = { id: createId(), ...result.value, createdAt: now, updatedAt: now };
    this.projects.value = [project, ...this.projects.value];
    this.markDirty();
    return { ok: true, value: project };
  }

  updateProject(id: string, input: Partial<ProjectInput>): ValidationResult<Project> {
    const existing = this.getProject(id);
    if (!existing) return { ok: false, errors: { id: 'Project no longer exists.' } };
    const result = validateProject({
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      status: input.status ?? existing.status,
      color: input.color ?? existing.color,
    });
    if (!result.ok) return result;
    const updated: Project = { ...existing, ...result.value, updatedAt: this.now() };
    this.projects.value = this.projects.value.map((p) => (p.id === id ? updated : p));
    this.markDirty();
    return { ok: true, value: updated };
  }

  /**
   * Delete a project. Linked tasks, notes and research are kept and detached
   * (never silently deleted) unless `cascade` is true.
   */
  deleteProject(id: string, options: { cascade?: boolean } = {}): boolean {
    if (!this.getProject(id)) return false;
    const now = this.now();
    batch(() => {
      this.projects.value = this.projects.value.filter((p) => p.id !== id);
      if (options.cascade) {
        const noteIds = new Set(
          this.notes.value.filter((n) => n.projectId === id).map((n) => n.id),
        );
        this.tasks.value = this.tasks.value.filter((t) => t.projectId !== id);
        this.notes.value = this.notes.value.filter((n) => n.projectId !== id);
        this.research.value = this.research.value
          .filter((r) => r.projectId !== id)
          .map((r) =>
            r.noteId && noteIds.has(r.noteId) ? { ...r, noteId: null, updatedAt: now } : r,
          );
      } else {
        const detach = <T extends { projectId: string | null; updatedAt: string }>(
          rows: readonly T[],
        ): T[] =>
          rows.map((r) => (r.projectId === id ? { ...r, projectId: null, updatedAt: now } : r));
        this.tasks.value = detach(this.tasks.value);
        this.notes.value = detach(this.notes.value);
        this.research.value = detach(this.research.value);
      }
    });
    this.markDirty();
    return true;
  }

  /* ------------------------------ research ----------------------------- */

  getResearch(id: string): ResearchItem | undefined {
    return this.research.value.find((r) => r.id === id);
  }

  createResearch(input: ResearchInput): ValidationResult<ResearchItem> {
    const result = validateResearch(input);
    if (!result.ok) return result;
    const err = this.checkRefs(result.value.projectId, result.value.noteId);
    if (err) return err;
    const now = this.now();
    const item: ResearchItem = { id: createId(), ...result.value, createdAt: now, updatedAt: now };
    this.research.value = [item, ...this.research.value];
    this.markDirty();
    return { ok: true, value: item };
  }

  updateResearch(id: string, input: Partial<ResearchInput>): ValidationResult<ResearchItem> {
    const existing = this.getResearch(id);
    if (!existing) return { ok: false, errors: { id: 'Research item no longer exists.' } };
    const result = validateResearch({
      title: input.title ?? existing.title,
      url: input.url === undefined ? existing.url : input.url,
      summary: input.summary ?? existing.summary,
      tags: input.tags ?? existing.tags,
      projectId: input.projectId === undefined ? existing.projectId : input.projectId,
      noteId: input.noteId === undefined ? existing.noteId : input.noteId,
    });
    if (!result.ok) return result;
    const err = this.checkRefs(result.value.projectId, result.value.noteId);
    if (err) return err;
    const updated: ResearchItem = { ...existing, ...result.value, updatedAt: this.now() };
    this.research.value = this.research.value.map((r) => (r.id === id ? updated : r));
    this.markDirty();
    return { ok: true, value: updated };
  }

  deleteResearch(id: string): boolean {
    const before = this.research.value.length;
    this.research.value = this.research.value.filter((r) => r.id !== id);
    const removed = this.research.value.length !== before;
    if (removed) this.markDirty();
    return removed;
  }

  /* ------------------------------ internals ---------------------------- */

  private checkRefs(
    projectId: string | null,
    noteId: string | null,
  ): { ok: false; errors: Record<string, string> } | null {
    if (projectId !== null && !this.getProject(projectId)) {
      return { ok: false, errors: { projectId: 'That project no longer exists.' } };
    }
    if (noteId !== null && !this.getNote(noteId)) {
      return { ok: false, errors: { noteId: 'That note no longer exists.' } };
    }
    return null;
  }

  private applyData(data: WorkspaceData): void {
    this.tasks.value = data.tasks;
    this.notes.value = data.notes;
    this.projects.value = data.projects;
    this.research.value = data.research;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.saveDelayMs <= 0) {
      this.flush();
      return;
    }
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, this.saveDelayMs);
  }
}

function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014
    );
  }
  return error instanceof Error && /quota/i.test(error.message);
}
