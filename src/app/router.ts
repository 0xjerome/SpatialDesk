import { signal } from '@preact/signals-core';

export type RouteName =
  'home' | 'tasks' | 'notes' | 'projects' | 'research' | 'assistant' | 'settings' | 'spatial';

export interface Route {
  name: RouteName;
  /** Optional record id, e.g. #/projects/<id> or #/notes/<id>. */
  id: string | null;
  /** Free-form query, e.g. #/tasks?q=milk */
  params: URLSearchParams;
}

export const ROUTE_NAMES: readonly RouteName[] = [
  'home',
  'tasks',
  'notes',
  'projects',
  'research',
  'assistant',
  'settings',
  'spatial',
];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?', 2) as [string, string?];
  const segments = pathPart.split('/').filter(Boolean);
  const first = (segments[0] ?? 'home') as RouteName;
  const name = ROUTE_NAMES.includes(first) ? first : 'home';
  const id = segments[1] ? decodeURIComponent(segments[1]) : null;
  return { name, id, params: new URLSearchParams(queryPart) };
}

export function hrefFor(
  name: RouteName,
  id?: string | null,
  params?: Record<string, string>,
): string {
  let href = `#/${name}`;
  if (id) href += `/${encodeURIComponent(id)}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) href += `?${qs}`;
  }
  return href;
}

export class Router {
  readonly route = signal<Route>(parseHash(typeof location !== 'undefined' ? location.hash : ''));
  private readonly onHashChange = () => {
    this.route.value = parseHash(location.hash);
  };

  start(): () => void {
    window.addEventListener('hashchange', this.onHashChange);
    this.onHashChange();
    return () => window.removeEventListener('hashchange', this.onHashChange);
  }

  navigate(name: RouteName, id?: string | null, params?: Record<string, string>): void {
    const href = hrefFor(name, id, params);
    if (location.hash === href) {
      this.onHashChange();
      return;
    }
    location.hash = href;
  }
}
