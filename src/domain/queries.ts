import type { Note, Project, ResearchItem, Task, TaskPriority, TaskStatus } from './types';

export type TaskStatusFilter = TaskStatus | 'all' | 'open';
export type TaskSort = 'created' | 'due' | 'priority' | 'title';

export interface TaskFilter {
  status?: TaskStatusFilter;
  priority?: TaskPriority | 'all';
  projectId?: string | 'all' | 'none';
  query?: string;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export function matchesQuery(haystack: readonly string[], query: string | undefined): boolean {
  const q = (query ?? '').trim().toLowerCase();
  if (q === '') return true;
  return haystack.some((h) => h.toLowerCase().includes(q));
}

export function filterTasks(tasks: readonly Task[], filter: TaskFilter): Task[] {
  return tasks.filter((t) => {
    const status = filter.status ?? 'all';
    if (status === 'open' && t.status === 'done') return false;
    if (status !== 'all' && status !== 'open' && t.status !== status) return false;
    if (filter.priority && filter.priority !== 'all' && t.priority !== filter.priority) return false;
    if (filter.projectId && filter.projectId !== 'all') {
      if (filter.projectId === 'none' ? t.projectId !== null : t.projectId !== filter.projectId) return false;
    }
    return matchesQuery([t.title, t.description], filter.query);
  });
}

export function sortTasks(tasks: readonly Task[], sort: TaskSort): Task[] {
  const copy = [...tasks];
  switch (sort) {
    case 'due':
      copy.sort((a, b) => {
        if (a.dueDate === b.dueDate) return b.createdAt.localeCompare(a.createdAt);
        if (a.dueDate === null) return 1;
        if (b.dueDate === null) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
      break;
    case 'priority':
      copy.sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt),
      );
      break;
    case 'title':
      copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      break;
    case 'created':
    default:
      copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return copy;
}

export function searchNotes(notes: readonly Note[], query: string | undefined, projectId?: string | 'all'): Note[] {
  return notes
    .filter((n) => (!projectId || projectId === 'all' ? true : n.projectId === projectId))
    .filter((n) => matchesQuery([n.title, n.body], query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function searchResearch(
  items: readonly ResearchItem[],
  query: string | undefined,
  options: { projectId?: string | 'all'; tag?: string | null } = {},
): ResearchItem[] {
  return items
    .filter((r) => (!options.projectId || options.projectId === 'all' ? true : r.projectId === options.projectId))
    .filter((r) => (options.tag ? r.tags.includes(options.tag) : true))
    .filter((r) => matchesQuery([r.title, r.summary, r.url ?? '', ...r.tags], query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface ProjectProgress {
  total: number;
  done: number;
  open: number;
  /** 0..1, or 0 when the project has no tasks. */
  ratio: number;
  overdue: number;
}

/** Compute progress from stored tasks only; never estimated. */
export function projectProgress(project: Project, tasks: readonly Task[], today = todayIso()): ProjectProgress {
  const own = tasks.filter((t) => t.projectId === project.id);
  const done = own.filter((t) => t.status === 'done').length;
  const overdue = own.filter((t) => t.status !== 'done' && t.dueDate !== null && t.dueDate < today).length;
  return {
    total: own.length,
    done,
    open: own.length - done,
    ratio: own.length === 0 ? 0 : done / own.length,
    overdue,
  };
}

export function isOverdue(task: Task, today = todayIso()): boolean {
  return task.status !== 'done' && task.dueDate !== null && task.dueDate < today;
}

export function isDueToday(task: Task, today = todayIso()): boolean {
  return task.status !== 'done' && task.dueDate === today;
}

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function collectTags(items: readonly ResearchItem[]): string[] {
  const counts = new Map<string, number>();
  for (const r of items) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
