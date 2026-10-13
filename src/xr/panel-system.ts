import { createSystem, effect, signal, UIKitMLAsset, type UIKit } from '@iwsdk/core';
import type { Input as HorizonInput } from '@pmndrs/uikit-horizon';
import type { Component } from '@pmndrs/uikit';
import {
  filterTasks,
  isOverdue,
  projectProgress,
  searchNotes,
  searchResearch,
  sortTasks,
} from '../domain/queries';
import type { Note, Project, ResearchItem, Task } from '../domain/types';
import { findTaskByVoiceQuery, parseVoiceCommand, type VoiceCommand } from '../voice/commands';
import { SpeechError } from '../voice/provider';
import { BRIDGE_KEY, type XrBridge } from './bridge';

export type Section = 'home' | 'tasks' | 'notes' | 'projects' | 'research';
const SECTIONS: readonly Section[] = ['home', 'tasks', 'notes', 'projects', 'research'];
const PAGE_SIZE = 6;

interface RowItem {
  kind: 'task' | 'note' | 'project' | 'research';
  id: string;
  title: string;
  meta: string;
  /** Label for the round toggle; empty hides it. */
  toggle: string;
}

export interface Selection {
  kind: RowItem['kind'];
  id: string;
}

/**
 * Binds the two UIKitML panels to the shared workspace store. All state lives
 * in signals so the panels re-render whenever data changes, whether the change
 * came from a pinch in XR or from the 2D app before the session started.
 */
export class WorkspacePanelSystem extends createSystem({}) {
  readonly section = signal<Section>('home');
  readonly page = signal(0);
  readonly selected = signal<Selection | null>(null);
  readonly showDone = signal(false);
  readonly projectFilter = signal<string | null>(null);
  readonly status = signal('Ready');
  readonly voiceProposal = signal<VoiceCommand | null>(null);
  readonly bound = signal(false);

  private bridge!: XrBridge;
  private main: UIKitMLAsset | null = null;
  private detail: UIKitMLAsset | null = null;
  private voiceAbort: AbortController | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Array<() => void> = [];

  override init(): void {
    const bridge = (this.world.globals as Record<string, unknown>)[BRIDGE_KEY] as
      XrBridge | undefined;
    if (!bridge) {
      throw new Error(
        'WorkspacePanelSystem needs world.globals.spatialdesk to be set before registration.',
      );
    }
    this.bridge = bridge;
    if (!this.bind()) {
      // The level may still be loading; bind as soon as it is active.
      this.cleanupFuncs.push(this.world.activeLevel.subscribe(() => this.bind()));
    }
    this.cleanupFuncs.push(() => this.teardown());
  }

  /* ------------------------------ wiring ------------------------------ */

  private bind(): boolean {
    if (this.bound.peek()) return true;
    const main = this.world.getSceneObject<UIKitMLAsset>('workspace-panel');
    const detail = this.world.getSceneObject<UIKitMLAsset>('detail-panel');
    if (!main || !detail || !(main instanceof UIKitMLAsset) || !(detail instanceof UIKitMLAsset))
      return false;
    this.main = main;
    this.detail = detail;

    for (const s of SECTIONS) this.on(main, `tab-${s}`, () => this.showSection(s));
    for (let i = 0; i < PAGE_SIZE; i += 1) {
      this.on(main, `row-${i}`, () => this.activateRow(i));
      this.on(main, `row-${i}-toggle`, (e) => {
        e.stopPropagation?.();
        this.toggleRow(i);
      });
    }
    this.on(main, 'page-prev', () => this.turnPage(-1));
    this.on(main, 'page-next', () => this.turnPage(1));
    this.on(main, 'filter-button', () => (this.showDone.value = !this.showDone.peek()));
    this.on(main, 'quick-add', () => this.quickAdd());
    this.on(main, 'voice-button', () => void this.startVoice());
    this.on(main, 'voice-confirm', () => this.confirmVoice());
    this.on(main, 'voice-cancel', () => this.cancelVoice());
    this.on(main, 'exit-button', () => this.exit());
    this.on(detail, 'primary-action', () => this.detailPrimary());
    this.on(detail, 'secondary-action', () => this.detailSecondary());
    this.on(detail, 'close-action', () => (this.selected.value = null));

    this.cleanupFuncs.push(effect(() => this.renderMain()));
    this.cleanupFuncs.push(effect(() => this.renderDetail()));
    this.bound.value = true;
    return true;
  }

  private on(
    panel: UIKitMLAsset,
    id: string,
    handler: (event: { stopPropagation?: () => void }) => void,
  ): void {
    const el = panel.getElementById(id);
    if (!el) {
      console.warn(`[SpatialDesk] UIKitML element #${id} is missing`);
      return;
    }
    const listener = (event: { stopPropagation?: () => void }) => handler(event);
    el.addEventListener('click', listener);
    this.listeners.push(() => el.removeEventListener('click', listener));
  }

  private teardown(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
    this.voiceAbort?.abort();
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.bound.value = false;
    this.main = null;
    this.detail = null;
  }

  private text(panel: UIKitMLAsset | null, id: string, text: string): void {
    panel?.getElementById<UIKit.Text>(id)?.setProperties({ text });
  }
  private show(panel: UIKitMLAsset | null, id: string, visible: boolean): void {
    panel?.getElementById(id)?.setProperties({ display: visible ? 'flex' : 'none' });
  }

  /* ----------------------------- actions ------------------------------ */

  showSection(section: Section): void {
    this.section.value = section;
    this.page.value = 0;
    if (section !== 'tasks') this.projectFilter.value = null;
  }

  turnPage(delta: number): void {
    const pages = Math.max(1, Math.ceil(this.items().length / PAGE_SIZE));
    this.page.value = Math.min(pages - 1, Math.max(0, this.page.peek() + delta));
  }

  activateRow(index: number): void {
    const item = this.pageItems()[index];
    if (!item) return;
    this.selected.value = { kind: item.kind, id: item.id };
  }

  toggleRow(index: number): void {
    const item = this.pageItems()[index];
    if (!item || item.kind !== 'task') return;
    const r = this.bridge.store.toggleTaskDone(item.id);
    this.flash(
      r.ok
        ? r.value.status === 'done'
          ? `Completed "${r.value.title}"`
          : `Reopened "${r.value.title}"`
        : 'Could not update task',
    );
  }

  quickAdd(): void {
    const input = this.main?.getElementById<HorizonInput>('quick-input');
    const value = input?.input?.currentSignal.value?.trim() ?? '';
    if (value === '') {
      this.flash('Type something first');
      return;
    }
    const section = this.section.peek();
    const store = this.bridge.store;
    const result =
      section === 'notes'
        ? store.createNote({ title: value, body: '' })
        : section === 'research'
          ? store.createResearch({ title: value })
          : section === 'projects'
            ? store.createProject({ name: value })
            : store.createTask({ title: value, projectId: this.projectFilter.peek() });
    if (result.ok) {
      this.flash(`Added "${value}"`);
      if (input?.input) {
        input.input.uncontrolledSignal.value = '';
        input.input.element.value = '';
      }
    } else {
      this.flash(Object.values(result.errors)[0] ?? 'Could not add');
    }
  }

  detailPrimary(): void {
    const sel = this.selected.peek();
    if (!sel) return;
    const store = this.bridge.store;
    if (sel.kind === 'task') {
      const r = store.toggleTaskDone(sel.id);
      if (r.ok) this.flash(r.value.status === 'done' ? 'Completed' : 'Reopened');
    } else if (sel.kind === 'project') {
      this.projectFilter.value = sel.id;
      this.section.value = 'tasks';
      this.page.value = 0;
      this.selected.value = null;
    }
  }

  detailSecondary(): void {
    const sel = this.selected.peek();
    if (!sel) return;
    const store = this.bridge.store;
    const projectId =
      sel.kind === 'task'
        ? store.getTask(sel.id)?.projectId
        : sel.kind === 'note'
          ? store.getNote(sel.id)?.projectId
          : sel.kind === 'research'
            ? store.getResearch(sel.id)?.projectId
            : null;
    if (projectId) this.selected.value = { kind: 'project', id: projectId };
  }

  exit(): void {
    if (this.world.session) this.world.exitXR();
    else this.bridge.onExitRequested();
  }

  /* ------------------------------ voice ------------------------------- */

  async startVoice(): Promise<void> {
    const speech = this.bridge.speech;
    if (!speech.available) {
      this.flash(speech.unavailableReason ?? 'Voice unavailable', 5000);
      return;
    }
    if (this.voiceAbort) {
      this.voiceAbort.abort();
      return;
    }
    this.voiceProposal.value = null;
    this.voiceAbort = new AbortController();
    this.status.value = 'Listening… (press Voice again to stop)';
    try {
      const result = await speech.listenOnce({
        signal: this.voiceAbort.signal,
        onInterim: (t) => (this.status.value = `Listening… "${t}"`),
      });
      const command = parseVoiceCommand(result.transcript);
      this.voiceProposal.value = command;
      this.status.value = this.describe(command, result.transcript);
    } catch (e) {
      this.status.value =
        e instanceof SpeechError && e.code === 'aborted'
          ? 'Listening stopped'
          : e instanceof Error
            ? e.message
            : 'Voice failed';
      this.voiceProposal.value = null;
    } finally {
      this.voiceAbort = null;
    }
  }

  private describe(command: VoiceCommand, transcript: string): string {
    switch (command.kind) {
      case 'create_task':
        return `Create task "${command.title}"?`;
      case 'create_note':
        return `Save note "${command.title}"?`;
      case 'complete_task': {
        const { match } = findTaskByVoiceQuery(this.bridge.store.tasks.peek(), command.query);
        return match ? `Mark "${match.title}" as done?` : `No open task matches "${command.query}"`;
      }
      case 'navigate':
        return `Open ${command.target}?`;
      case 'search':
        return `Search for "${command.query}"?`;
      default:
        return `Heard "${transcript}" but did not recognise a command.`;
    }
  }

  confirmVoice(): void {
    const command = this.voiceProposal.peek();
    this.voiceProposal.value = null;
    if (!command) return;
    const store = this.bridge.store;
    switch (command.kind) {
      case 'create_task': {
        const r = store.createTask({ title: command.title });
        this.flash(r.ok ? `Created "${r.value.title}"` : 'Could not create task');
        break;
      }
      case 'create_note': {
        const r = store.createNote({ title: command.title, body: command.body });
        this.flash(r.ok ? `Saved note "${r.value.title}"` : 'Could not save note');
        if (r.ok) this.showSection('notes');
        break;
      }
      case 'complete_task': {
        const { match } = findTaskByVoiceQuery(store.tasks.peek(), command.query);
        if (match) {
          store.updateTask(match.id, { status: 'done' });
          this.flash(`Completed "${match.title}"`);
        } else this.flash('No matching task');
        break;
      }
      case 'navigate':
        this.showSection(command.target === 'assistant' ? 'home' : command.target);
        this.flash(`Opened ${command.target}`);
        break;
      case 'search':
        this.flash('Search is available in the browser app');
        break;
      default:
        this.flash('Nothing changed');
    }
  }

  cancelVoice(): void {
    this.voiceProposal.value = null;
    this.status.value = 'Cancelled';
  }

  private flash(message: string, ttl = 3000): void {
    this.status.value = message;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      if (this.status.peek() === message) this.status.value = 'Ready';
    }, ttl);
  }

  /* ------------------------------ data -------------------------------- */

  private items(): RowItem[] {
    const store = this.bridge.store;
    const section = this.section.value;
    const projectFilter = this.projectFilter.value;
    switch (section) {
      case 'tasks':
      case 'home': {
        const filtered = filterTasks(store.tasks.value, {
          status: section === 'home' || !this.showDone.value ? 'open' : 'all',
          projectId: projectFilter ?? 'all',
        });
        return sortTasks(filtered, 'due').map((t) => this.taskRow(t));
      }
      case 'notes':
        return searchNotes(store.notes.value, '').map((n) => ({
          kind: 'note',
          id: n.id,
          title: n.title,
          meta: n.body.split('\n')[0]?.slice(0, 60) || 'Empty note',
          toggle: '',
        }));
      case 'projects':
        return store.projects.value.map((p) => {
          const progress = projectProgress(p, store.tasks.value);
          return {
            kind: 'project',
            id: p.id,
            title: p.name,
            meta: progress.total === 0 ? 'No tasks' : `${progress.done}/${progress.total} done`,
            toggle: '',
          };
        });
      case 'research':
        return searchResearch(store.research.value, '').map((r) => ({
          kind: 'research',
          id: r.id,
          title: r.title,
          meta: r.url ?? r.summary.slice(0, 60) ?? '',
          toggle: '',
        }));
      default:
        return [];
    }
  }

  private taskRow(t: Task): RowItem {
    const project = t.projectId ? this.bridge.store.getProject(t.projectId) : undefined;
    const parts = [t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Medium'];
    if (t.dueDate) parts.push(isOverdue(t) ? `Overdue ${t.dueDate}` : `Due ${t.dueDate}`);
    if (project) parts.push(project.name);
    return {
      kind: 'task',
      id: t.id,
      title: t.title,
      meta: parts.join(' | '),
      toggle: t.status === 'done' ? 'x' : ' ',
    };
  }

  private pageItems(): RowItem[] {
    const all = this.items();
    const start = this.page.value * PAGE_SIZE;
    return all.slice(start, start + PAGE_SIZE);
  }

  /* ----------------------------- render ------------------------------- */

  private renderMain(): void {
    const main = this.main;
    if (!main) return;
    const store = this.bridge.store;
    const section = this.section.value;
    const all = this.items();
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const page = Math.min(this.page.value, pages - 1);
    const rows = all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const selected = this.selected.value;
    const open = store.openTasks.value.length;
    const overdue = store.tasks.value.filter((t) => isOverdue(t)).length;
    const project = this.projectFilter.value
      ? store.getProject(this.projectFilter.value)
      : undefined;

    this.text(
      main,
      'subtitle',
      section === 'home'
        ? `${open} open tasks${overdue ? `, ${overdue} overdue` : ''} | ${store.notes.value.length} notes | ${store.projects.value.length} projects`
        : section === 'tasks' && project
          ? `Tasks in ${project.name}`
          : all.length === 0
            ? `No ${section} yet`
            : `${all.length} ${section === 'research' ? 'items' : section}`,
    );
    for (const s of SECTIONS) {
      const active = s === section;
      main
        .getElementById(`tab-${s}`)
        ?.setProperties({ backgroundColor: active ? '#5c6cff' : '#1d2747' });
      main
        .getElementById<UIKit.Text>(`tab-${s}-label`)
        ?.setProperties({ color: active ? '#0b1020' : '#c8d0f0' });
    }
    const quick = main.getElementById<HorizonInput>('quick-input');
    quick?.setProperties({
      placeholder:
        section === 'notes'
          ? 'New note title'
          : section === 'projects'
            ? 'New project'
            : section === 'research'
              ? 'New research title'
              : project
                ? `New task in ${project.name}`
                : 'New task',
    });

    for (let i = 0; i < PAGE_SIZE; i += 1) {
      const row = rows[i];
      const el = main.getElementById(`row-${i}`);
      if (!row) {
        el?.setProperties({ display: 'none' });
        continue;
      }
      el?.setProperties({
        display: 'flex',
        borderWidth: selected && selected.id === row.id ? 2 : 0,
        borderColor: '#7c8cff',
      });
      this.text(
        main,
        `row-${i}-title`,
        row.title.length > 48 ? `${row.title.slice(0, 45)}...` : row.title,
      );
      this.text(main, `row-${i}-meta`, row.meta);
      this.show(main, `row-${i}-toggle`, row.toggle !== '');
      this.text(main, `row-${i}-toggle-label`, row.toggle);
    }
    this.text(main, 'page-label', `Page ${page + 1} of ${pages}`);
    this.show(main, 'page-prev', pages > 1);
    this.show(main, 'page-next', pages > 1);
    this.show(main, 'filter-button', section === 'tasks');
    this.text(main, 'filter-label', this.showDone.value ? 'All' : 'Open');
    this.text(main, 'status', this.status.value);
    this.show(
      main,
      'voice-actions',
      this.voiceProposal.value !== null && this.voiceProposal.value.kind !== 'unknown',
    );
    this.show(main, 'voice-button', this.bridge.speech.available);
    this.text(main, 'title', this.bridge.immersive.value ? 'SpatialDesk' : 'SpatialDesk (preview)');
  }

  private renderDetail(): void {
    const detail = this.detail;
    if (!detail) return;
    const store = this.bridge.store;
    const sel = this.selected.value;
    const record: Task | Note | Project | ResearchItem | undefined = sel
      ? sel.kind === 'task'
        ? store.getTask(sel.id)
        : sel.kind === 'note'
          ? store.getNote(sel.id)
          : sel.kind === 'project'
            ? store.getProject(sel.id)
            : store.getResearch(sel.id)
      : undefined;
    if (!sel || !record) {
      this.text(detail, 'kind', 'DETAIL');
      this.text(detail, 'title', 'Nothing selected');
      this.text(detail, 'meta', '');
      this.text(
        detail,
        'body',
        'Select an item in the workspace panel to see it here. Pinch the bar above a panel to move it.',
      );
      this.show(detail, 'primary-action', false);
      this.show(detail, 'secondary-action', false);
      this.show(detail, 'close-action', false);
      return;
    }
    this.show(detail, 'close-action', true);
    if (sel.kind === 'task') {
      const t = record as Task;
      const project = t.projectId ? store.getProject(t.projectId) : undefined;
      this.text(detail, 'kind', 'TASK');
      this.text(detail, 'title', t.title);
      this.text(
        detail,
        'meta',
        `${t.status === 'done' ? 'Done' : t.status === 'in_progress' ? 'In progress' : 'To do'} | ${t.priority} priority${t.dueDate ? ` | due ${t.dueDate}` : ''}${project ? ` | ${project.name}` : ''}`,
      );
      this.text(detail, 'body', t.description || 'No description.');
      this.show(detail, 'primary-action', true);
      this.text(detail, 'primary-label', t.status === 'done' ? 'Reopen' : 'Complete');
      this.show(detail, 'secondary-action', Boolean(project));
      this.text(detail, 'secondary-label', 'Open project');
    } else if (sel.kind === 'note') {
      const n = record as Note;
      const project = n.projectId ? store.getProject(n.projectId) : undefined;
      this.text(detail, 'kind', 'NOTE');
      this.text(detail, 'title', n.title);
      this.text(detail, 'meta', project ? project.name : 'No project');
      this.text(
        detail,
        'body',
        n.body
          ? n.body.length > 600
            ? `${n.body.slice(0, 600)}...`
            : n.body
          : 'Empty note. Edit it in the browser app.',
      );
      this.show(detail, 'primary-action', false);
      this.show(detail, 'secondary-action', Boolean(project));
      this.text(detail, 'secondary-label', 'Open project');
    } else if (sel.kind === 'project') {
      const p = record as Project;
      const progress = projectProgress(p, store.tasks.value);
      this.text(detail, 'kind', 'PROJECT');
      this.text(detail, 'title', p.name);
      this.text(
        detail,
        'meta',
        `${p.status} | ${progress.done} of ${progress.total} tasks done${progress.overdue ? ` | ${progress.overdue} overdue` : ''}`,
      );
      this.text(detail, 'body', p.description || 'No description.');
      this.show(detail, 'primary-action', true);
      this.text(detail, 'primary-label', 'View tasks');
      this.show(detail, 'secondary-action', false);
    } else {
      const r = record as ResearchItem;
      const project = r.projectId ? store.getProject(r.projectId) : undefined;
      this.text(detail, 'kind', 'RESEARCH');
      this.text(detail, 'title', r.title);
      this.text(
        detail,
        'meta',
        [r.url ?? '', r.tags.map((t) => `#${t}`).join(' ')].filter(Boolean).join(' | '),
      );
      this.text(detail, 'body', r.summary || 'No summary saved.');
      this.show(detail, 'primary-action', false);
      this.show(detail, 'secondary-action', Boolean(project));
      this.text(detail, 'secondary-label', 'Open project');
    }
  }

  /** Test and debugging hook: element lookups by id on the two panels. */
  element(panel: 'main' | 'detail', id: string): Component | null {
    return (panel === 'main' ? this.main : this.detail)?.getElementById(id) ?? null;
  }
}
