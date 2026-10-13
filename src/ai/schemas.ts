/**
 * Client-side validation of AI assistant responses. The server validates too,
 * but the browser never trusts a network payload blindly: every suggestion is
 * checked here before it can be shown or saved.
 */
import type { TaskPriority } from '../domain/types';
import { isValidIsoDate, TASK_PRIORITIES } from '../domain';

export type AssistAction = 'organize_tasks' | 'draft_task_from_note' | 'summarize' | 'break_down_project';

export interface TaskGroup {
  name: string;
  taskIds: string[];
  rationale: string;
}
export interface TaskSuggestion {
  taskId: string;
  priority: TaskPriority | null;
  dueDate: string | null;
  reason: string;
}
export interface OrganizeTasksResult {
  groups: TaskGroup[];
  suggestions: TaskSuggestion[];
}
export interface DraftedTask {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
}
export interface DraftTaskFromNoteResult {
  tasks: DraftedTask[];
  note: string;
}
export interface SummarizeResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
}
export interface ProjectStep {
  title: string;
  description: string;
  priority: TaskPriority;
}
export interface BreakDownProjectResult {
  steps: ProjectStep[];
}

export type AssistResultMap = {
  organize_tasks: OrganizeTasksResult;
  draft_task_from_note: DraftTaskFromNoteResult;
  summarize: SummarizeResult;
  break_down_project: BreakDownProjectResult;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}
function strList(v: unknown, max: number, maxItems: number): string[] | null {
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = str(item, max);
    if (s === null) return null;
    if (s.trim() !== '') out.push(s.trim());
  }
  return out;
}
function priority(v: unknown): TaskPriority | null {
  return TASK_PRIORITIES.includes(v as TaskPriority) ? (v as TaskPriority) : null;
}
function dateOrNull(v: unknown): { ok: boolean; value: string | null } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === 'string' && isValidIsoDate(v)) return { ok: true, value: v };
  return { ok: false, value: null };
}

function parseDraftedTask(v: unknown): DraftedTask | null {
  if (!isRecord(v)) return null;
  const title = str(v.title, 200)?.trim();
  if (!title) return null;
  const p = priority(v.priority) ?? 'medium';
  const d = dateOrNull(v.dueDate);
  return { title, description: str(v.description, 4000)?.trim() ?? '', priority: p, dueDate: d.ok ? d.value : null };
}

export function parseOrganizeTasks(v: unknown, knownTaskIds: ReadonlySet<string>): OrganizeTasksResult | null {
  if (!isRecord(v) || !Array.isArray(v.groups) || !Array.isArray(v.suggestions)) return null;
  const groups: TaskGroup[] = [];
  const assigned = new Set<string>();
  for (const g of v.groups.slice(0, 12)) {
    if (!isRecord(g)) return null;
    const name = str(g.name, 80)?.trim();
    const ids = strList(g.taskIds, 64, 100);
    if (!name || ids === null) return null;
    // Only keep ids we actually own, and never list a task twice.
    const taskIds = ids.filter((id) => knownTaskIds.has(id) && !assigned.has(id));
    taskIds.forEach((id) => assigned.add(id));
    if (taskIds.length > 0) groups.push({ name, taskIds, rationale: str(g.rationale, 400)?.trim() ?? '' });
  }
  const suggestions: TaskSuggestion[] = [];
  for (const s of v.suggestions.slice(0, 100)) {
    if (!isRecord(s)) return null;
    const taskId = str(s.taskId, 64);
    if (!taskId || !knownTaskIds.has(taskId)) continue;
    const d = dateOrNull(s.dueDate);
    const p = s.priority === null || s.priority === undefined ? null : priority(s.priority);
    if (!d.ok) continue;
    if (p === null && d.value === null) continue;
    suggestions.push({ taskId, priority: p, dueDate: d.value, reason: str(s.reason, 300)?.trim() ?? '' });
  }
  return { groups, suggestions };
}

export function parseDraftTaskFromNote(v: unknown): DraftTaskFromNoteResult | null {
  if (!isRecord(v) || !Array.isArray(v.tasks)) return null;
  const tasks: DraftedTask[] = [];
  for (const t of v.tasks.slice(0, 10)) {
    const task = parseDraftedTask(t);
    if (task === null) return null;
    tasks.push(task);
  }
  return { tasks, note: str(v.note, 300)?.trim() ?? '' };
}

export function parseSummarize(v: unknown): SummarizeResult | null {
  if (!isRecord(v)) return null;
  const summary = str(v.summary, 2000)?.trim();
  const keyPoints = strList(v.keyPoints ?? [], 300, 10);
  const actionItems = strList(v.actionItems ?? [], 300, 10);
  if (!summary || keyPoints === null || actionItems === null) return null;
  return { summary, keyPoints, actionItems };
}

export function parseBreakDownProject(v: unknown): BreakDownProjectResult | null {
  if (!isRecord(v) || !Array.isArray(v.steps) || v.steps.length === 0 || v.steps.length > 15) return null;
  const steps: ProjectStep[] = [];
  for (const s of v.steps) {
    if (!isRecord(s)) return null;
    const title = str(s.title, 200)?.trim();
    if (!title) return null;
    steps.push({ title, description: str(s.description, 4000)?.trim() ?? '', priority: priority(s.priority) ?? 'medium' });
  }
  return { steps };
}
