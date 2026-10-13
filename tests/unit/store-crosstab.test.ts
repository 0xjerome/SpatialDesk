import { describe, expect, it } from 'vitest';
import { LocalStorageAdapter, STORAGE_KEY, serializeWorkspace } from '../../src/domain/persistence';
import { WorkspaceStore } from '../../src/domain/store';

describe('cross-tab synchronisation', () => {
  it('reloads when another tab writes and this tab has nothing pending', () => {
    localStorage.clear();
    const store = new WorkspaceStore({
      storage: new LocalStorageAdapter(localStorage),
      saveDelayMs: 0,
    });
    expect(store.tasks.value).toHaveLength(0);
    // Simulate another tab persisting a task.
    localStorage.setItem(
      STORAGE_KEY,
      serializeWorkspace({
        tasks: [{ id: 'remote', title: 'From other tab' } as never],
        notes: [],
        projects: [],
        research: [],
      }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: localStorage.getItem(STORAGE_KEY),
      }),
    );
    expect(store.tasks.value.map((t) => t.title)).toEqual(['From other tab']);
    expect(store.externalUpdates.value).toBe(1);
    store.dispose();
  });

  it('ignores events for other keys and keeps unsaved local edits', () => {
    localStorage.clear();
    const store = new WorkspaceStore({
      storage: new LocalStorageAdapter(localStorage),
      saveDelayMs: 10_000,
    });
    store.createTask({ title: 'local pending' });
    localStorage.setItem(
      STORAGE_KEY,
      serializeWorkspace({ tasks: [], notes: [], projects: [], research: [] }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'x' }));
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: localStorage.getItem(STORAGE_KEY),
      }),
    );
    expect(store.tasks.value.map((t) => t.title)).toEqual(['local pending']);
    expect(store.externalUpdates.value).toBe(0);
    store.flush();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).data.tasks).toHaveLength(1);
    store.dispose();
  });

  it('reports a full storage clearly', () => {
    const store = new WorkspaceStore({
      storage: {
        kind: 'local',
        read: () => null,
        write: () => {
          throw new DOMException('quota', 'QuotaExceededError');
        },
        remove: () => undefined,
      },
      saveDelayMs: 0,
      crossTab: false,
    });
    store.createTask({ title: 'too big' });
    expect(store.status.value).toBe('error');
    expect(store.lastError.value).toMatch(/storage is full/);
  });
});
