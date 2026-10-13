import { describe, expect, it } from 'vitest';
import {
  coerceTask,
  isValidIsoDate,
  normalizeTags,
  normalizeUrl,
  parseTagInput,
  validateNote,
  validateProject,
  validateResearch,
  validateTask,
} from '../../src/domain/validation';

describe('validateTask', () => {
  it('rejects an empty title', () => {
    const r = validateTask({ title: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.title).toBeDefined();
  });
  it('applies defaults and trims', () => {
    const r = validateTask({ title: '  Ship it  ' });
    expect(r).toEqual({
      ok: true,
      value: {
        title: 'Ship it',
        description: '',
        status: 'todo',
        priority: 'medium',
        dueDate: null,
        projectId: null,
      },
    });
  });
  it('rejects impossible dates', () => {
    expect(validateTask({ title: 'x', dueDate: '2026-02-30' }).ok).toBe(false);
    expect(validateTask({ title: 'x', dueDate: '2026-13-01' }).ok).toBe(false);
    expect(validateTask({ title: 'x', dueDate: 'tomorrow' }).ok).toBe(false);
    expect(validateTask({ title: 'x', dueDate: '2026-02-28' }).ok).toBe(true);
  });
  it('rejects unknown enum values from untrusted input', () => {
    expect(validateTask({ title: 'x', status: 'archived' as never }).ok).toBe(false);
    expect(validateTask({ title: 'x', priority: 'urgent' as never }).ok).toBe(false);
  });
  it('enforces length limits', () => {
    expect(validateTask({ title: 'a'.repeat(201) }).ok).toBe(false);
    expect(validateTask({ title: 'a', description: 'b'.repeat(4001) }).ok).toBe(false);
  });
});

describe('isValidIsoDate', () => {
  it('handles leap years', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2023-02-29')).toBe(false);
  });
});

describe('validateNote / validateProject', () => {
  it('keeps note body whitespace but normalises line endings', () => {
    const r = validateNote({ title: 'n', body: 'line1\r\nline2' });
    expect(r.ok && r.value.body).toBe('line1\nline2');
  });
  it('rejects a note over the size limit', () => {
    expect(validateNote({ title: 'n', body: 'x'.repeat(50_001) }).ok).toBe(false);
  });
  it('defaults project status and colour', () => {
    const r = validateProject({ name: 'P' });
    expect(r.ok && r.value).toEqual({
      name: 'P',
      description: '',
      status: 'active',
      color: 'indigo',
    });
  });
});

describe('normalizeUrl', () => {
  it('prefixes https for bare domains', () => {
    expect(normalizeUrl('example.com/page')).toEqual({ ok: true, url: 'https://example.com/page' });
  });
  it('keeps http', () => {
    expect(normalizeUrl('http://example.com')).toEqual({ ok: true, url: 'http://example.com/' });
  });
  it('blocks unsafe schemes', () => {
    expect(normalizeUrl('javascript:alert(1)').ok).toBe(false);
    expect(normalizeUrl('data:text/html,hi').ok).toBe(false);
    expect(normalizeUrl('file:///etc/passwd').ok).toBe(false);
  });
  it('rejects garbage', () => {
    expect(normalizeUrl('not a url').ok).toBe(false);
    expect(normalizeUrl('justaword').ok).toBe(false);
    expect(normalizeUrl('').ok).toBe(false);
  });
});

describe('tags', () => {
  it('normalises, dedupes and caps tags', () => {
    expect(normalizeTags([' #WebXR ', 'webxr', 'Quest', ''])).toEqual(['webxr', 'quest']);
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
  });
  it('parses comma separated input', () => {
    expect(parseTagInput('a, b,\nc')).toEqual(['a', 'b', 'c']);
  });
});

describe('validateResearch', () => {
  it('validates the url when present', () => {
    const bad = validateResearch({ title: 't', url: 'javascript:x' });
    expect(bad.ok).toBe(false);
    const good = validateResearch({ title: 't', url: 'docs.example.org', tags: ['A'] });
    expect(good.ok && good.value.url).toBe('https://docs.example.org/');
    expect(good.ok && good.value.tags).toEqual(['a']);
  });
  it('allows a source without a link', () => {
    const r = validateResearch({ title: 'Book', summary: 'Chapter 3' });
    expect(r.ok && r.value.url).toBeNull();
  });
});

describe('coerceTask', () => {
  it('repairs partial records and drops unusable ones', () => {
    const now = '2026-01-01T00:00:00.000Z';
    expect(coerceTask({ id: 'a', title: 'ok', status: 'bogus', priority: 7 }, now)).toMatchObject({
      id: 'a',
      status: 'todo',
      priority: 'medium',
      createdAt: now,
      completedAt: null,
    });
    expect(coerceTask({ id: 'b' }, now)).toBeNull();
    expect(coerceTask({ title: 'no id' }, now)).toBeNull();
    expect(coerceTask('string', now)).toBeNull();
  });
  it('keeps completedAt only for done tasks', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const done = coerceTask({ id: 'a', title: 'x', status: 'done' }, now);
    expect(done?.completedAt).toBe(now);
  });
});
