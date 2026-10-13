import { describe, expect, it } from 'vitest';
import { hrefFor, parseHash } from '../../src/app/router';

describe('router', () => {
  it('parses routes, ids and params', () => {
    expect(parseHash('')).toMatchObject({ name: 'home', id: null });
    expect(parseHash('#/tasks')).toMatchObject({ name: 'tasks', id: null });
    expect(parseHash('#/notes/abc%20d')).toMatchObject({ name: 'notes', id: 'abc d' });
    expect(parseHash('#/tasks?q=milk').params.get('q')).toBe('milk');
    expect(parseHash('#/unknown/x')).toMatchObject({ name: 'home' });
  });
  it('builds hrefs', () => {
    expect(hrefFor('projects', 'p 1', { q: 'a b' })).toBe('#/projects/p%201?q=a+b');
    expect(hrefFor('home')).toBe('#/home');
  });
});
