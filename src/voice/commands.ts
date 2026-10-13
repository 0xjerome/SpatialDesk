/**
 * Turn a recognised utterance into a proposed action. Parsing is deterministic
 * and local; the proposal is always shown to the user for confirmation before
 * anything is saved, so recognition mistakes never silently change data.
 */
export type VoiceCommand =
  | { kind: 'create_task'; title: string }
  | { kind: 'create_note'; title: string; body: string }
  | { kind: 'complete_task'; query: string }
  | { kind: 'search'; query: string }
  | { kind: 'navigate'; target: 'home' | 'tasks' | 'notes' | 'projects' | 'research' | 'assistant' }
  | { kind: 'unknown'; transcript: string };

const NAV: Record<string, VoiceCommand & { kind: 'navigate' }> = {
  home: { kind: 'navigate', target: 'home' },
  workspace: { kind: 'navigate', target: 'home' },
  tasks: { kind: 'navigate', target: 'tasks' },
  notes: { kind: 'navigate', target: 'notes' },
  projects: { kind: 'navigate', target: 'projects' },
  research: { kind: 'navigate', target: 'research' },
  assistant: { kind: 'navigate', target: 'assistant' },
};

function clean(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[.?!,]+$/g, '')
    .trim();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const text = clean(transcript);
  const lower = text.toLowerCase();
  if (lower === '') return { kind: 'unknown', transcript };

  let m =
    /^(?:please )?(?:add|create|new|make)(?: a| an)? (?:task|to ?do|reminder)(?: to| called| named|:)? (.+)$/i.exec(
      text,
    );
  if (m?.[1]) return { kind: 'create_task', title: capitalize(clean(m[1])) };
  m = /^(?:please )?remind me to (.+)$/i.exec(text);
  if (m?.[1]) return { kind: 'create_task', title: capitalize(clean(m[1])) };

  m =
    /^(?:please )?(?:add|create|new|make|take|capture)(?: a| an)? note(?: called| titled| named|:)? (.+)$/i.exec(
      text,
    );
  if (m?.[1]) {
    const body = clean(m[1]);
    const title = body.length > 60 ? `${body.slice(0, 57).trimEnd()}...` : body;
    return { kind: 'create_note', title: capitalize(title), body: capitalize(body) };
  }
  m = /^(?:please )?note (?:that )?(.+)$/i.exec(text);
  if (m?.[1]) {
    const body = clean(m[1]);
    const title = body.length > 60 ? `${body.slice(0, 57).trimEnd()}...` : body;
    return { kind: 'create_note', title: capitalize(title), body: capitalize(body) };
  }

  m =
    /^(?:please )?(?:complete|finish|mark(?: as)? (?:done|complete)|check off|done with)(?: the)?(?: task)? (.+)$/i.exec(
      text,
    );
  if (m?.[1]) return { kind: 'complete_task', query: clean(m[1]).replace(/^(?:task )/i, '') };
  m = /^(?:please )?mark (.+?) (?:as )?(?:done|complete|completed|finished)$/i.exec(text);
  if (m?.[1])
    return { kind: 'complete_task', query: clean(m[1]).replace(/^(?:the )?(?:task )?/i, '') };

  m = /^(?:please )?(?:search|find|look up|look for|show me)(?: for)? (.+)$/i.exec(text);
  if (m?.[1]) return { kind: 'search', query: clean(m[1]) };

  m = /^(?:please )?(?:go to|open|show|switch to)(?: the| my)? (\w+)$/i.exec(text);
  if (m?.[1]) {
    const target = NAV[m[1].toLowerCase()];
    if (target) return target;
  }
  if (NAV[lower]) return NAV[lower]!;

  return { kind: 'unknown', transcript: text };
}

/** Pick the task that best matches a spoken description, or null when ambiguous. */
export function findTaskByVoiceQuery<T extends { id: string; title: string; status: string }>(
  tasks: readonly T[],
  query: string,
): { match: T | null; candidates: T[] } {
  const q = query.toLowerCase().trim();
  if (q === '') return { match: null, candidates: [] };
  const open = tasks.filter((t) => t.status !== 'done');
  const exact = open.filter((t) => t.title.toLowerCase() === q);
  if (exact.length === 1) return { match: exact[0]!, candidates: exact };
  const partial = open.filter(
    (t) => t.title.toLowerCase().includes(q) || q.includes(t.title.toLowerCase()),
  );
  if (partial.length === 1) return { match: partial[0]!, candidates: partial };
  const words = q.split(' ').filter((w) => w.length > 2);
  const scored = open
    .map((t) => ({ t, score: words.filter((w) => t.title.toLowerCase().includes(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 1 || (scored.length > 1 && scored[0]!.score > scored[1]!.score)) {
    return { match: scored[0]!.t, candidates: scored.slice(0, 5).map((s) => s.t) };
  }
  return { match: null, candidates: scored.slice(0, 5).map((s) => s.t) };
}
