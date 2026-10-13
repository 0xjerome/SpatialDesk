import { describe, expect, it } from 'vitest';
import {
  parseBreakDownProject,
  parseDraftTaskFromNote,
  parseOrganizeTasks,
  parseSummarize,
} from '../../src/ai/schemas';

describe('parseOrganizeTasks', () => {
  const known = new Set(['a', 'b', 'c']);
  it('drops unknown ids and duplicate assignments', () => {
    const r = parseOrganizeTasks(
      {
        groups: [
          { name: 'Now', taskIds: ['a', 'zzz', 'b'], rationale: 'urgent' },
          { name: 'Later', taskIds: ['b', 'c'], rationale: '' },
          { name: 'Empty', taskIds: ['zzz'], rationale: '' },
        ],
        suggestions: [
          { taskId: 'a', priority: 'high', dueDate: null, reason: 'x' },
          { taskId: 'nope', priority: 'high', dueDate: null, reason: '' },
          { taskId: 'b', priority: null, dueDate: '2026-02-30', reason: 'bad date' },
          { taskId: 'c', priority: null, dueDate: null, reason: 'nothing to change' },
          {
            taskId: 'c',
            priority: 'urgent',
            dueDate: '2026-03-01',
            reason: 'bad prio but good date',
          },
        ],
      },
      known,
    );
    expect(r?.groups.map((g) => [g.name, g.taskIds])).toEqual([
      ['Now', ['a', 'b']],
      ['Later', ['c']],
    ]);
    expect(r?.suggestions).toEqual([
      { taskId: 'a', priority: 'high', dueDate: null, reason: 'x' },
      { taskId: 'c', priority: null, dueDate: '2026-03-01', reason: 'bad prio but good date' },
    ]);
  });
  it('rejects malformed payloads', () => {
    expect(parseOrganizeTasks(null, known)).toBeNull();
    expect(parseOrganizeTasks({ groups: 'x', suggestions: [] }, known)).toBeNull();
    expect(parseOrganizeTasks({ groups: [{ taskIds: [] }], suggestions: [] }, known)).toBeNull();
  });
});

describe('parseDraftTaskFromNote', () => {
  it('fills defaults and validates dates', () => {
    const r = parseDraftTaskFromNote({
      tasks: [{ title: ' Call bank ', priority: 'nope', dueDate: 'soon' }],
      note: 1,
    });
    expect(r).toEqual({
      tasks: [{ title: 'Call bank', description: '', priority: 'medium', dueDate: null }],
      note: '',
    });
  });
  it('rejects a task without a title', () => {
    expect(parseDraftTaskFromNote({ tasks: [{ description: 'x' }] })).toBeNull();
  });
  it('allows an empty task list', () => {
    expect(parseDraftTaskFromNote({ tasks: [], note: 'Nothing actionable' })?.note).toBe(
      'Nothing actionable',
    );
  });
});

describe('parseSummarize / parseBreakDownProject', () => {
  it('requires a summary', () => {
    expect(parseSummarize({ summary: '', keyPoints: [] })).toBeNull();
    expect(parseSummarize({ summary: 'ok' })).toEqual({
      summary: 'ok',
      keyPoints: [],
      actionItems: [],
    });
  });
  it('rejects non-string points', () => {
    expect(parseSummarize({ summary: 'ok', keyPoints: [1] })).toBeNull();
  });
  it('requires at least one step', () => {
    expect(parseBreakDownProject({ steps: [] })).toBeNull();
    expect(parseBreakDownProject({ steps: [{ title: 'Plan', priority: 'high' }] })).toEqual({
      steps: [{ title: 'Plan', description: '', priority: 'high' }],
    });
  });
});
