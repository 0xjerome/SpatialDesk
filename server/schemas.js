// @ts-check
/**
 * Zod schemas shared by the AI route: request bodies are validated before any
 * provider call, and provider output is validated before it is returned.
 * The browser re-validates responses independently (src/ai/schemas.ts).
 */
import { z } from 'zod';

const TITLE = z.string().min(1).max(200);
const TEXT = z.string().max(4000);
const PRIORITY = z.enum(['low', 'medium', 'high']);
const STATUS = z.enum(['todo', 'in_progress', 'done']);
const DATE_OR_NULL = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const MAX_INPUT_CHARS = 60_000;

/* ----------------------------- request bodies ----------------------------- */

export const OrganizeTasksRequest = z.object({
  action: z.literal('organize_tasks'),
  input: z.object({
    tasks: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          title: TITLE,
          description: TEXT.default(''),
          status: STATUS,
          priority: PRIORITY,
          dueDate: DATE_OR_NULL,
        }),
      )
      .min(1)
      .max(100),
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

export const DraftTaskFromNoteRequest = z.object({
  action: z.literal('draft_task_from_note'),
  input: z.object({
    note: z.object({ title: TITLE, body: z.string().max(MAX_INPUT_CHARS) }),
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

export const SummarizeRequest = z.object({
  action: z.literal('summarize'),
  input: z.object({
    title: z.string().max(200).default(''),
    text: z.string().min(1).max(MAX_INPUT_CHARS),
  }),
});

export const BreakDownProjectRequest = z.object({
  action: z.literal('break_down_project'),
  input: z.object({
    project: z.object({ name: TITLE, description: TEXT.default('') }),
    existingTasks: z.array(TITLE).max(100).default([]),
  }),
});

export const AssistRequest = z.discriminatedUnion('action', [
  OrganizeTasksRequest,
  DraftTaskFromNoteRequest,
  SummarizeRequest,
  BreakDownProjectRequest,
]);

/* ----------------------------- model outputs ------------------------------ */

export const OrganizeTasksOutput = z.object({
  groups: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        taskIds: z.array(z.string()).max(100),
        rationale: z.string().max(400),
      }),
    )
    .max(12),
  suggestions: z
    .array(
      z.object({
        taskId: z.string(),
        priority: PRIORITY.nullable(),
        dueDate: DATE_OR_NULL,
        reason: z.string().max(300),
      }),
    )
    .max(100),
});

export const DraftedTask = z.object({
  title: TITLE,
  description: TEXT,
  priority: PRIORITY,
  dueDate: DATE_OR_NULL,
});

export const DraftTaskFromNoteOutput = z.object({
  tasks: z.array(DraftedTask).min(0).max(10),
  note: z.string().max(300),
});

export const SummarizeOutput = z.object({
  summary: z.string().min(1).max(2000),
  keyPoints: z.array(z.string().max(300)).max(10),
  actionItems: z.array(z.string().max(300)).max(10),
});

export const BreakDownProjectOutput = z.object({
  steps: z
    .array(
      z.object({
        title: TITLE,
        description: TEXT,
        priority: PRIORITY,
      }),
    )
    .min(1)
    .max(15),
});

/** @type {Record<string, z.ZodTypeAny>} */
export const OUTPUT_SCHEMAS = {
  organize_tasks: OrganizeTasksOutput,
  draft_task_from_note: DraftTaskFromNoteOutput,
  summarize: SummarizeOutput,
  break_down_project: BreakDownProjectOutput,
};
