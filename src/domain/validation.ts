import type {
  Note,
  Project,
  ProjectColor,
  ProjectStatus,
  ResearchItem,
  Task,
  TaskPriority,
  TaskStatus,
} from './types';
import { LIMITS, PROJECT_COLORS, PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from './types';

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export interface TaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  projectId?: string | null;
}

export interface NoteInput {
  title: string;
  body?: string;
  projectId?: string | null;
}

export interface ProjectInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  color?: ProjectColor;
}

export interface ResearchInput {
  title: string;
  url?: string | null;
  summary?: string;
  tags?: string[];
  projectId?: string | null;
  noteId?: string | null;
}

export type TaskDraft = Required<TaskInput>;
export type NoteDraft = Required<NoteInput>;
export type ProjectDraft = Required<ProjectInput>;
export type ResearchDraft = Required<ResearchInput>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Validate a calendar date string in YYYY-MM-DD form. */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Normalise a user-supplied URL. Accepts bare domains ("example.com") by
 * prefixing https://, and only allows http(s) schemes so a saved link can never
 * be a javascript: or data: URL.
 */
export function normalizeUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (value === '') return { ok: false, error: 'Enter a link.' };
  if (value.length > LIMITS.url) return { ok: false, error: 'Link is too long.' };
  if (/\s/.test(value)) return { ok: false, error: 'Links cannot contain spaces.' };
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Enter a valid link such as https://example.com.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https links are supported.' };
  }
  if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
    return { ok: false, error: 'Enter a full domain such as example.com.' };
  }
  return { ok: true, url: parsed.toString() };
}

export function validateTask(input: TaskInput): ValidationResult<TaskDraft> {
  const errors: FieldErrors = {};
  const title = cleanText(input.title);
  const description = cleanText(input.description ?? '');
  if (title === '') errors.title = 'Give the task a title.';
  else if (title.length > LIMITS.title)
    errors.title = `Keep the title under ${LIMITS.title} characters.`;
  if (description.length > LIMITS.description)
    errors.description = `Keep the description under ${LIMITS.description} characters.`;

  const status = input.status ?? 'todo';
  if (!TASK_STATUSES.includes(status)) errors.status = 'Unknown status.';
  const priority = input.priority ?? 'medium';
  if (!TASK_PRIORITIES.includes(priority)) errors.priority = 'Unknown priority.';

  let dueDate: string | null = null;
  if (typeof input.dueDate === 'string' && input.dueDate.trim() !== '') {
    if (!isValidIsoDate(input.dueDate.trim())) errors.dueDate = 'Use a real date (YYYY-MM-DD).';
    else dueDate = input.dueDate.trim();
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description,
      status,
      priority,
      dueDate,
      projectId: optionalId(input.projectId),
    },
  };
}

export function validateNote(input: NoteInput): ValidationResult<NoteDraft> {
  const errors: FieldErrors = {};
  const title = cleanText(input.title);
  const body = typeof input.body === 'string' ? input.body.replace(/\r\n/g, '\n') : '';
  if (title === '') errors.title = 'Give the note a title.';
  else if (title.length > LIMITS.title)
    errors.title = `Keep the title under ${LIMITS.title} characters.`;
  if (body.length > LIMITS.noteBody)
    errors.body = `Notes are limited to ${LIMITS.noteBody} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { title, body, projectId: optionalId(input.projectId) } };
}

export function validateProject(input: ProjectInput): ValidationResult<ProjectDraft> {
  const errors: FieldErrors = {};
  const name = cleanText(input.name);
  const description = cleanText(input.description ?? '');
  if (name === '') errors.name = 'Give the project a name.';
  else if (name.length > LIMITS.title)
    errors.name = `Keep the name under ${LIMITS.title} characters.`;
  if (description.length > LIMITS.description)
    errors.description = `Keep the description under ${LIMITS.description} characters.`;
  const status = input.status ?? 'active';
  if (!PROJECT_STATUSES.includes(status)) errors.status = 'Unknown status.';
  const color = input.color ?? 'indigo';
  if (!PROJECT_COLORS.includes(color)) errors.color = 'Unknown colour.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, description, status, color } };
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags ?? []) {
    const tag = cleanText(raw).toLowerCase().replace(/^#/, '').slice(0, LIMITS.tag);
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= LIMITS.tags) break;
  }
  return result;
}

export function parseTagInput(raw: string): string[] {
  return normalizeTags(raw.split(/[,\n]/));
}

export function validateResearch(input: ResearchInput): ValidationResult<ResearchDraft> {
  const errors: FieldErrors = {};
  const title = cleanText(input.title);
  const summary = cleanText(input.summary ?? '');
  if (title === '') errors.title = 'Give the research item a title.';
  else if (title.length > LIMITS.title)
    errors.title = `Keep the title under ${LIMITS.title} characters.`;
  if (summary.length > LIMITS.summary)
    errors.summary = `Keep the summary under ${LIMITS.summary} characters.`;
  let url: string | null = null;
  if (typeof input.url === 'string' && input.url.trim() !== '') {
    const result = normalizeUrl(input.url);
    if (result.ok) url = result.url;
    else errors.url = result.error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      url,
      summary,
      tags: normalizeTags(input.tags),
      projectId: optionalId(input.projectId),
      noteId: optionalId(input.noteId),
    },
  };
}

/* ---------- Record-level guards used when loading persisted or imported data ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isoOrNow(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

/** Coerce an untrusted object into a Task, or return null when it is unusable. */
export function coerceTask(value: unknown, now: string): Task | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null;
  const draft = validateTask({
    title: str(value.title),
    description: str(value.description),
    status: TASK_STATUSES.includes(value.status as TaskStatus)
      ? (value.status as TaskStatus)
      : 'todo',
    priority: TASK_PRIORITIES.includes(value.priority as TaskPriority)
      ? (value.priority as TaskPriority)
      : 'medium',
    dueDate: typeof value.dueDate === 'string' ? value.dueDate : null,
    projectId: optionalId(value.projectId),
  });
  if (!draft.ok) return null;
  const createdAt = isoOrNow(value.createdAt, now);
  return {
    id: value.id,
    ...draft.value,
    createdAt,
    updatedAt: isoOrNow(value.updatedAt, createdAt),
    completedAt: draft.value.status === 'done' ? isoOrNow(value.completedAt, createdAt) : null,
  };
}

export function coerceNote(value: unknown, now: string): Note | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null;
  const draft = validateNote({
    title: str(value.title),
    body: str(value.body),
    projectId: optionalId(value.projectId),
  });
  if (!draft.ok) return null;
  const createdAt = isoOrNow(value.createdAt, now);
  return {
    id: value.id,
    ...draft.value,
    createdAt,
    updatedAt: isoOrNow(value.updatedAt, createdAt),
  };
}

export function coerceProject(value: unknown, now: string): Project | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null;
  const draft = validateProject({
    name: str(value.name),
    description: str(value.description),
    status: PROJECT_STATUSES.includes(value.status as ProjectStatus)
      ? (value.status as ProjectStatus)
      : 'active',
    color: PROJECT_COLORS.includes(value.color as ProjectColor)
      ? (value.color as ProjectColor)
      : 'indigo',
  });
  if (!draft.ok) return null;
  const createdAt = isoOrNow(value.createdAt, now);
  return {
    id: value.id,
    ...draft.value,
    createdAt,
    updatedAt: isoOrNow(value.updatedAt, createdAt),
  };
}

export function coerceResearch(value: unknown, now: string): ResearchItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null;
  const draft = validateResearch({
    title: str(value.title),
    url: typeof value.url === 'string' ? value.url : null,
    summary: str(value.summary),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((t): t is string => typeof t === 'string')
      : [],
    projectId: optionalId(value.projectId),
    noteId: optionalId(value.noteId),
  });
  if (!draft.ok) return null;
  const createdAt = isoOrNow(value.createdAt, now);
  return {
    id: value.id,
    ...draft.value,
    createdAt,
    updatedAt: isoOrNow(value.updatedAt, createdAt),
  };
}
