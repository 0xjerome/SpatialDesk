import { describe, expect, it } from 'vitest';
import {
  collectTags,
  filterTasks,
  isOverdue,
  projectProgress,
  searchNotes,
  searchResearch,
  sortTasks,
} from '../../src/domain/queries';
import type { Note, Project, ResearchItem, Task } from '../../src/domain/types';

const base = {
  description: '',
  projectId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  completedAt: null,
};
const tasks: Task[] = [
  {
    ...base,
    id: '1',
    title: 'Alpha',
    status: 'todo',
    priority: 'low',
    dueDate: '2026-01-10',
    createdAt: '2026-01-03T00:00:00Z',
  },
  {
    ...base,
    id: '2',
    title: 'Bravo',
    status: 'done',
    priority: 'high',
    dueDate: null,
    createdAt: '2026-01-02T00:00:00Z',
  },
  {
    ...base,
    id: '3',
    title: 'Charlie',
    status: 'in_progress',
    priority: 'medium',
    dueDate: '2026-01-05',
    projectId: 'p',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

describe('filterTasks', () => {
  it('filters by status, priority, project and query', () => {
    expect(filterTasks(tasks, { status: 'open' }).map((t) => t.id)).toEqual(['1', '3']);
    expect(filterTasks(tasks, { status: 'done' }).map((t) => t.id)).toEqual(['2']);
    expect(filterTasks(tasks, { priority: 'high' }).map((t) => t.id)).toEqual(['2']);
    expect(filterTasks(tasks, { projectId: 'p' }).map((t) => t.id)).toEqual(['3']);
    expect(filterTasks(tasks, { projectId: 'none' }).map((t) => t.id)).toEqual(['1', '2']);
    expect(filterTasks(tasks, { query: 'ALPH' }).map((t) => t.id)).toEqual(['1']);
  });
});

describe('sortTasks', () => {
  it('sorts by due date with undated last', () => {
    expect(sortTasks(tasks, 'due').map((t) => t.id)).toEqual(['3', '1', '2']);
  });
  it('sorts by priority then newest', () => {
    expect(sortTasks(tasks, 'priority').map((t) => t.id)).toEqual(['2', '3', '1']);
  });
  it('sorts by title and created', () => {
    expect(sortTasks(tasks, 'title').map((t) => t.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(sortTasks(tasks, 'created').map((t) => t.id)).toEqual(['1', '2', '3']);
  });
});

describe('projectProgress', () => {
  const project: Project = {
    id: 'p',
    name: 'P',
    description: '',
    status: 'active',
    color: 'indigo',
    createdAt: '',
    updatedAt: '',
  };
  it('counts only the project tasks from real data', () => {
    const progress = projectProgress(project, tasks, '2026-01-08');
    expect(progress).toEqual({ total: 1, done: 0, open: 1, ratio: 0, overdue: 1 });
  });
  it('is zero for an empty project', () => {
    expect(projectProgress(project, [], '2026-01-08').ratio).toBe(0);
  });
});

describe('overdue', () => {
  it('ignores done tasks', () => {
    expect(isOverdue(tasks[0]!, '2026-02-01')).toBe(true);
    expect(isOverdue({ ...tasks[0]!, status: 'done' }, '2026-02-01')).toBe(false);
  });
});

describe('search', () => {
  const notes: Note[] = [
    {
      id: 'n1',
      title: 'Meeting',
      body: 'Discussed WebXR hands',
      projectId: null,
      createdAt: '',
      updatedAt: '2026-01-02',
    },
    {
      id: 'n2',
      title: 'Groceries',
      body: 'milk',
      projectId: 'p',
      createdAt: '',
      updatedAt: '2026-01-03',
    },
  ];
  it('searches note titles and bodies, newest first', () => {
    expect(searchNotes(notes, 'webxr').map((n) => n.id)).toEqual(['n1']);
    expect(searchNotes(notes, '').map((n) => n.id)).toEqual(['n2', 'n1']);
    expect(searchNotes(notes, '', 'p').map((n) => n.id)).toEqual(['n2']);
  });
  const research: ResearchItem[] = [
    {
      id: 'r1',
      title: 'Spec',
      url: 'https://immersive-web.github.io/',
      summary: '',
      tags: ['webxr', 'spec'],
      projectId: null,
      noteId: null,
      createdAt: '',
      updatedAt: '1',
    },
    {
      id: 'r2',
      title: 'Blog',
      url: null,
      summary: 'hand tracking tips',
      tags: ['webxr'],
      projectId: null,
      noteId: null,
      createdAt: '',
      updatedAt: '2',
    },
  ];
  it('searches research by text, url and tag', () => {
    expect(searchResearch(research, 'github').map((r) => r.id)).toEqual(['r1']);
    expect(searchResearch(research, 'hand').map((r) => r.id)).toEqual(['r2']);
    expect(searchResearch(research, '', { tag: 'spec' }).map((r) => r.id)).toEqual(['r1']);
    expect(collectTags(research)).toEqual(['webxr', 'spec']);
  });
});
