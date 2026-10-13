import type { Note, Project, Task } from '../domain/types';
import { todayIso } from '../domain/queries';
import {
  parseBreakDownProject,
  parseDraftTaskFromNote,
  parseOrganizeTasks,
  parseSummarize,
  type AssistAction,
  type AssistResultMap,
} from './schemas';

export type AssistErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'offline'
  | 'provider_error'
  | 'invalid_output'
  | 'auth'
  | 'bad_request'
  | 'cancelled';

export class AssistError extends Error {
  constructor(
    readonly code: AssistErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssistError';
  }
}

export interface AssistantStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  maxInputChars: number;
  /** True when the status endpoint itself could not be reached. */
  unreachable: boolean;
}

export interface AssistResponse<A extends AssistAction> {
  action: A;
  result: AssistResultMap[A];
  model: string;
}

export interface AssistantClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const FRIENDLY: Record<AssistErrorCode, string> = {
  not_configured:
    'The assistant is not configured on this server. Add an ANTHROPIC_API_KEY to enable it.',
  rate_limited: 'Too many requests right now. Please wait a moment and try again.',
  timeout: 'The assistant took too long to respond. Try again, or send less material.',
  offline: 'You appear to be offline. The assistant needs a network connection.',
  provider_error: 'The assistant provider returned an error. Please try again.',
  invalid_output: 'The assistant returned something unexpected, so nothing was saved.',
  auth: 'The server AI credentials were rejected. Check the server configuration.',
  bad_request: 'The request was rejected. Try with different material.',
  cancelled: 'The request was cancelled.',
};

export function friendlyAssistMessage(error: unknown): string {
  if (error instanceof AssistError) return FRIENDLY[error.code];
  return 'Something went wrong while contacting the assistant.';
}

/**
 * Browser client for the /api/ai routes. It never holds provider credentials.
 */
export class AssistantClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: AssistantClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async status(signal?: AbortSignal): Promise<AssistantStatus> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/ai/status`, {
        signal,
        cache: 'no-store',
      });
      if (!res.ok)
        return {
          configured: false,
          provider: null,
          model: null,
          maxInputChars: 0,
          unreachable: true,
        };
      const json = (await res.json()) as Record<string, unknown>;
      return {
        configured: json.configured === true,
        provider: typeof json.provider === 'string' ? json.provider : null,
        model: typeof json.model === 'string' ? json.model : null,
        maxInputChars:
          typeof json.limits === 'object' &&
          json.limits !== null &&
          typeof (json.limits as Record<string, unknown>).maxInputChars === 'number'
            ? ((json.limits as Record<string, unknown>).maxInputChars as number)
            : 0,
        unreachable: false,
      };
    } catch {
      return {
        configured: false,
        provider: null,
        model: null,
        maxInputChars: 0,
        unreachable: true,
      };
    }
  }

  organizeTasks(tasks: readonly Task[], signal?: AbortSignal) {
    const ids = new Set(tasks.map((t) => t.id));
    return this.call(
      'organize_tasks',
      {
        tasks: tasks.slice(0, 100).map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description.slice(0, 4000),
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
        })),
        today: todayIso(),
      },
      (v) => parseOrganizeTasks(v, ids),
      signal,
    );
  }

  draftTasksFromNote(note: Pick<Note, 'title' | 'body'>, signal?: AbortSignal) {
    return this.call(
      'draft_task_from_note',
      { note: { title: note.title, body: note.body }, today: todayIso() },
      parseDraftTaskFromNote,
      signal,
    );
  }

  summarize(title: string, text: string, signal?: AbortSignal) {
    return this.call('summarize', { title, text }, parseSummarize, signal);
  }

  breakDownProject(
    project: Pick<Project, 'name' | 'description'>,
    existingTasks: readonly Task[],
    signal?: AbortSignal,
  ) {
    return this.call(
      'break_down_project',
      {
        project: { name: project.name, description: project.description },
        existingTasks: existingTasks.slice(0, 100).map((t) => t.title),
      },
      parseBreakDownProject,
      signal,
    );
  }

  private async call<A extends AssistAction>(
    action: A,
    input: unknown,
    parse: (v: unknown) => AssistResultMap[A] | null,
    signal?: AbortSignal,
  ): Promise<AssistResponse<A>> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new AssistError('offline', FRIENDLY.offline);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);
    const onAbort = () => controller.abort(new Error('cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/ai/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, input }),
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new AssistError('cancelled', FRIENDLY.cancelled);
      if (controller.signal.aborted) throw new AssistError('timeout', FRIENDLY.timeout);
      throw new AssistError(
        'offline',
        (error as Error)?.message ? FRIENDLY.offline : FRIENDLY.offline,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      throw new AssistError('invalid_output', FRIENDLY.invalid_output);
    }
    if (!res.ok) {
      const code = errorCodeFrom(json, res.status);
      throw new AssistError(code, FRIENDLY[code]);
    }
    if (typeof json !== 'object' || json === null)
      throw new AssistError('invalid_output', FRIENDLY.invalid_output);
    const payload = json as Record<string, unknown>;
    if (payload.action !== action) throw new AssistError('invalid_output', FRIENDLY.invalid_output);
    const result = parse(payload.result);
    if (result === null) throw new AssistError('invalid_output', FRIENDLY.invalid_output);
    return { action, result, model: typeof payload.model === 'string' ? payload.model : 'unknown' };
  }
}

const KNOWN_CODES: readonly AssistErrorCode[] = [
  'not_configured',
  'rate_limited',
  'timeout',
  'provider_error',
  'invalid_output',
  'auth',
  'bad_request',
];

function errorCodeFrom(json: unknown, status: number): AssistErrorCode {
  if (typeof json === 'object' && json !== null) {
    const err = (json as Record<string, unknown>).error;
    if (typeof err === 'object' && err !== null) {
      const code = (err as Record<string, unknown>).code;
      if (typeof code === 'string' && (KNOWN_CODES as readonly string[]).includes(code))
        return code as AssistErrorCode;
    }
  }
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'not_configured';
  if (status === 504) return 'timeout';
  if (status === 400 || status === 413 || status === 415) return 'bad_request';
  return 'provider_error';
}
