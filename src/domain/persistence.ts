import type { WorkspaceData } from './types';
import { emptyWorkspace } from './types';
import { coerceNote, coerceProject, coerceResearch, coerceTask } from './validation';

/** Current on-disk schema version. Bump when the stored shape changes. */
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'spatialdesk.workspace.v1';

export interface PersistedWorkspace {
  schemaVersion: number;
  savedAt: string;
  data: WorkspaceData;
}

/**
 * Minimal key/value boundary so the store can persist to localStorage in the
 * browser, memory in tests, or something else later without changing callers.
 */
export interface StorageAdapter {
  readonly kind: 'local' | 'memory';
  read(): string | null;
  write(value: string): void;
  remove(): void;
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  private value: string | null = null;
  read(): string | null {
    return this.value;
  }
  write(value: string): void {
    this.value = value;
  }
  remove(): void {
    this.value = null;
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;
  constructor(
    private readonly storage: Storage,
    private readonly key = STORAGE_KEY,
  ) {}
  read(): string | null {
    return this.storage.getItem(this.key);
  }
  write(value: string): void {
    this.storage.setItem(this.key, value);
  }
  remove(): void {
    this.storage.removeItem(this.key);
  }
}

/** Pick a storage adapter for the current runtime, falling back to memory. */
export function createDefaultStorage(): StorageAdapter {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__spatialdesk_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return new LocalStorageAdapter(localStorage);
    }
  } catch {
    // Private mode or blocked storage: fall through to memory.
  }
  return new MemoryStorageAdapter();
}

export interface LoadReport {
  data: WorkspaceData;
  /** Records that were present but could not be understood and were dropped. */
  dropped: number;
  /** True when nothing was stored yet. */
  fresh: boolean;
  /** Set when stored JSON was unreadable; the data is then empty. */
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalise any JSON payload (persisted or imported) into a valid workspace.
 * Every record is coerced individually so one corrupt item never loses the rest.
 */
export function normalizeWorkspace(
  payload: unknown,
  now = new Date().toISOString(),
): {
  data: WorkspaceData;
  dropped: number;
} {
  const root = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  const data = emptyWorkspace();
  let dropped = 0;
  if (!isRecord(root)) return { data, dropped: 0 };

  const list = (key: string): unknown[] =>
    Array.isArray(root[key]) ? (root[key] as unknown[]) : [];
  const seen = new Set<string>();
  const take = <T extends { id: string }>(
    items: unknown[],
    coerce: (v: unknown) => T | null,
  ): T[] => {
    const out: T[] = [];
    for (const item of items) {
      const rec = coerce(item);
      if (rec === null || seen.has(rec.id)) {
        dropped += 1;
        continue;
      }
      seen.add(rec.id);
      out.push(rec);
    }
    return out;
  };

  data.projects = take(list('projects'), (v) => coerceProject(v, now));
  data.notes = take(list('notes'), (v) => coerceNote(v, now));
  data.tasks = take(list('tasks'), (v) => coerceTask(v, now));
  data.research = take(list('research'), (v) => coerceResearch(v, now));

  // Repair dangling relationships so the UI never points at a missing record.
  const projectIds = new Set(data.projects.map((p) => p.id));
  const noteIds = new Set(data.notes.map((n) => n.id));
  for (const t of data.tasks) if (t.projectId && !projectIds.has(t.projectId)) t.projectId = null;
  for (const n of data.notes) if (n.projectId && !projectIds.has(n.projectId)) n.projectId = null;
  for (const r of data.research) {
    if (r.projectId && !projectIds.has(r.projectId)) r.projectId = null;
    if (r.noteId && !noteIds.has(r.noteId)) r.noteId = null;
  }
  return { data, dropped };
}

/** Migrate older persisted payloads forward. Currently only v1 exists. */
function migrate(payload: Record<string, unknown>): Record<string, unknown> {
  const version = typeof payload.schemaVersion === 'number' ? payload.schemaVersion : 0;
  if (version >= SCHEMA_VERSION) return payload;
  // v0 (pre-release) stored the bare WorkspaceData without an envelope.
  return { schemaVersion: SCHEMA_VERSION, savedAt: '', data: payload };
}

export function loadWorkspace(storage: StorageAdapter): LoadReport {
  const raw = storage.read();
  if (raw === null) return { data: emptyWorkspace(), dropped: 0, fresh: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      data: emptyWorkspace(),
      dropped: 0,
      fresh: false,
      error: `Stored workspace could not be read: ${(error as Error).message}`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      data: emptyWorkspace(),
      dropped: 0,
      fresh: false,
      error: 'Stored workspace had an unexpected shape.',
    };
  }
  const { data, dropped } = normalizeWorkspace(migrate(parsed));
  return { data, dropped, fresh: false };
}

export function serializeWorkspace(
  data: WorkspaceData,
  savedAt = new Date().toISOString(),
): string {
  const envelope: PersistedWorkspace = { schemaVersion: SCHEMA_VERSION, savedAt, data };
  return JSON.stringify(envelope);
}

export function saveWorkspace(storage: StorageAdapter, data: WorkspaceData): void {
  storage.write(serializeWorkspace(data));
}
