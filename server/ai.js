// @ts-check
/**
 * AI assistant provider. The Anthropic API key only ever lives in this process;
 * the browser talks to /api/ai/* and never sees provider credentials.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  BreakDownProjectOutput,
  DraftTaskFromNoteOutput,
  OrganizeTasksOutput,
  SummarizeOutput,
} from './schemas.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

const SYSTEM_PROMPT = [
  'You are the planning assistant inside SpatialDesk AI, a personal productivity workspace.',
  'Work only from the material the user supplies. Never invent facts, sources, dates or people.',
  'Keep every title short and specific. Use plain text, no markdown.',
  'When a due date is not clearly implied by the material, return null for it.',
  'Respond with JSON that matches the requested schema exactly.',
].join(' ');

/**
 * @typedef {{ code: 'not_configured' | 'rate_limited' | 'timeout' | 'provider_error' | 'invalid_output' | 'auth' | 'bad_request', message: string, status: number }} AssistError
 */

export class AssistantError extends Error {
  /**
   * @param {AssistError['code']} code
   * @param {string} message
   * @param {number} status
   */
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Build the user prompt and output schema for an action.
 * Exported so tests can check prompts without calling a provider.
 * @param {import('zod').infer<typeof import('./schemas.js').AssistRequest>} request
 */
export function buildAssistRequest(request) {
  switch (request.action) {
    case 'organize_tasks': {
      const lines = request.input.tasks.map(
        (t) =>
          `- id=${t.id} | ${t.title} | status=${t.status} | priority=${t.priority} | due=${t.dueDate ?? 'none'}` +
          (t.description ? ` | notes: ${t.description}` : ''),
      );
      return {
        schema: OrganizeTasksOutput,
        prompt: [
          `Today is ${request.input.today}.`,
          'Organise these tasks into a small number of meaningful groups (by theme, project or urgency).',
          'Every task id must appear in exactly one group. Only use ids from the list.',
          'Then suggest priority or due date changes only where the material clearly justifies it; otherwise leave the suggestions list short.',
          '',
          'Tasks:',
          ...lines,
        ].join('\n'),
      };
    }
    case 'draft_task_from_note':
      return {
        schema: DraftTaskFromNoteOutput,
        prompt: [
          `Today is ${request.input.today}.`,
          'Read the note below and propose the concrete tasks it implies (at most 10).',
          'If the note contains no actionable work, return an empty tasks list and explain briefly in "note".',
          '',
          `Note title: ${request.input.note.title}`,
          'Note body:',
          request.input.note.body,
        ].join('\n'),
      };
    case 'summarize':
      return {
        schema: SummarizeOutput,
        prompt: [
          'Summarise the material below for the person who wrote or saved it.',
          'Only include points that are actually present in the material.',
          '',
          request.input.title ? `Title: ${request.input.title}` : '',
          'Material:',
          request.input.text,
        ].join('\n'),
      };
    case 'break_down_project':
      return {
        schema: BreakDownProjectOutput,
        prompt: [
          'Break this project into an ordered list of concrete next steps (3 to 12).',
          'Do not repeat work that already exists as a task.',
          '',
          `Project: ${request.input.project.name}`,
          request.input.project.description ? `Description: ${request.input.project.description}` : '',
          request.input.existingTasks.length
            ? `Existing tasks:\n${request.input.existingTasks.map((t) => `- ${t}`).join('\n')}`
            : 'Existing tasks: none',
        ].join('\n'),
      };
    default:
      throw new AssistantError('bad_request', 'Unknown action.', 400);
  }
}

/**
 * @param {{ apiKey?: string, model?: string, timeoutMs?: number, client?: Anthropic }} options
 */
export function createAssistant(options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const configured = Boolean(options.client) || apiKey.trim() !== '';
  /** @type {Anthropic | null} */
  let client = options.client ?? null;

  function getClient() {
    if (client) return client;
    client = new Anthropic({
      apiKey,
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: 1,
    });
    return client;
  }

  return {
    model,
    configured,
    /**
     * Run one assistant action and return validated JSON.
     * @param {import('zod').infer<typeof import('./schemas.js').AssistRequest>} request
     * @param {AbortSignal} [signal]
     */
    async assist(request, signal) {
      if (!configured) {
        throw new AssistantError(
          'not_configured',
          'The AI assistant is not configured on this server. Set ANTHROPIC_API_KEY.',
          503,
        );
      }
      const { prompt, schema } = buildAssistRequest(request);
      let response;
      try {
        response = await getClient().beta.messages.create(
          {
            model,
            max_tokens: 4000,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
            output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal },
        );
      } catch (error) {
        throw mapProviderError(error);
      }
      if (response.stop_reason === 'refusal') {
        throw new AssistantError('provider_error', 'The assistant declined this request.', 502);
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AssistantError('invalid_output', 'The assistant response was cut off. Try with less material.', 502);
      }
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      /** @type {unknown} */
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AssistantError('invalid_output', 'The assistant returned malformed JSON.', 502);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new AssistantError('invalid_output', 'The assistant returned data in an unexpected shape.', 502);
      }
      return {
        action: request.action,
        result: parsed.data,
        model: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}

/**
 * Translate SDK errors into a small, stable set the client can act on.
 * @param {unknown} error
 */
export function mapProviderError(error) {
  if (error instanceof AssistantError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new AssistantError('auth', 'The server AI credentials were rejected by the provider.', 502);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AssistantError('rate_limited', 'The AI provider is rate limiting requests. Try again shortly.', 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AssistantError('bad_request', 'The AI provider rejected the request.', 502);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AssistantError('timeout', 'The AI provider did not respond in time.', 504);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AssistantError('provider_error', 'Could not reach the AI provider.', 502);
  }
  if (error instanceof Anthropic.APIError) {
    return new AssistantError('provider_error', `AI provider error (${error.status ?? 'unknown'}).`, 502);
  }
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    return new AssistantError('timeout', 'The request was cancelled.', 499);
  }
  return new AssistantError('provider_error', 'Unexpected AI provider failure.', 502);
}
