/**
 * Core SpatialDesk AI data model.
 *
 * All records are plain JSON-serialisable objects so the same shapes can be
 * persisted locally, exported, imported and shared between the browser UI and
 * the immersive workspace.
 */

export type Id = string;

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: Id;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** ISO date (YYYY-MM-DD) or null when there is no due date. */
  dueDate: string | null;
  projectId: Id | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Note {
  id: Id;
  title: string;
  body: string;
  projectId: Id | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'active' | 'paused' | 'completed';

export interface Project {
  id: Id;
  name: string;
  description: string;
  status: ProjectStatus;
  /** Accent colour token name used by the UI; never free-form CSS. */
  color: ProjectColor;
  createdAt: string;
  updatedAt: string;
}

export const PROJECT_COLORS = ['indigo', 'teal', 'amber', 'rose', 'lime', 'slate'] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export interface ResearchItem {
  id: Id;
  title: string;
  /** Validated http(s) URL or null for a source without a link. */
  url: string | null;
  /** User-written summary. Never auto-filled from a page we did not fetch. */
  summary: string;
  tags: string[];
  projectId: Id | null;
  noteId: Id | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceData {
  tasks: Task[];
  notes: Note[];
  projects: Project[];
  research: ResearchItem[];
}

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'done'];
export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high'];
export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'paused', 'completed'];

export const LIMITS = {
  title: 200,
  description: 4000,
  noteBody: 50_000,
  summary: 4000,
  tags: 20,
  tag: 40,
  url: 2048,
} as const;

export function emptyWorkspace(): WorkspaceData {
  return { tasks: [], notes: [], projects: [], research: [] };
}
