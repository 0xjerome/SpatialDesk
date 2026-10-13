import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { useApp } from './context';
import { hrefFor, type RouteName } from './router';
import {
  BookIcon,
  Banner,
  FolderIcon,
  HeadsetIcon,
  HomeIcon,
  MicIcon,
  NoteIcon,
  SettingsIcon,
  SparkIcon,
  TaskIcon,
} from './components/ui';
import { AssistantView } from './views/AssistantView';
import { HomeView } from './views/HomeView';
import { NotesView } from './views/NotesView';
import { ProjectsView } from './views/ProjectsView';
import { ResearchView } from './views/ResearchView';
import { SettingsView } from './views/SettingsView';
import { SpatialView } from './views/SpatialView';
import { TasksView } from './views/TasksView';
import { VoiceDialog } from './views/VoiceDialog';

const NAV: { name: RouteName; label: string; icon: ComponentChildren }[] = [
  { name: 'home', label: 'Workspace', icon: <HomeIcon /> },
  { name: 'tasks', label: 'Tasks', icon: <TaskIcon /> },
  { name: 'notes', label: 'Notes', icon: <NoteIcon /> },
  { name: 'projects', label: 'Projects', icon: <FolderIcon /> },
  { name: 'research', label: 'Research', icon: <BookIcon /> },
  { name: 'assistant', label: 'Assistant', icon: <SparkIcon /> },
  { name: 'spatial', label: 'Spatial', icon: <HeadsetIcon /> },
  { name: 'settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function App() {
  const { router, store, voiceOpen, speech } = useApp();
  const route = router.route.value;
  const open = store.openTasks.value.length;

  useEffect(() => {
    const flush = () => store.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => window.removeEventListener('pagehide', flush);
  }, [store]);

  // Scroll to top on route change and move focus to the main heading for screen readers.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [route.name, route.id]);

  const counts: Partial<Record<RouteName, number>> = {
    tasks: open,
    notes: store.notes.value.length,
    projects: store.projects.value.length,
    research: store.research.value.length,
  };

  return (
    <div class="shell">
      <a href="#main" class="sr-only">
        Skip to content
      </a>
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            S
          </div>
          <div>
            <div class="brand-name">SpatialDesk AI</div>
            <div class="brand-sub">Spatial productivity</div>
          </div>
        </div>
        <nav class="nav" aria-label="Primary">
          {NAV.map((n) => (
            <a
              key={n.name}
              href={hrefFor(n.name)}
              aria-current={route.name === n.name ? 'page' : undefined}
              data-testid={`nav-${n.name}`}
            >
              {n.icon}
              {n.label}
              {counts[n.name] ? <span class="nav-count">{counts[n.name]}</span> : null}
            </a>
          ))}
        </nav>
        <div class="sidebar-foot">
          {speech.available ? (
            <button
              type="button"
              class="btn"
              onClick={() => (voiceOpen.value = true)}
              data-testid="voice-open"
            >
              <MicIcon /> Voice command
            </button>
          ) : null}
          <span class="small faint">Data stays on this device</span>
        </div>
      </aside>
      <main id="main" class="main" tabIndex={-1}>
        {store.status.value === 'error' && store.lastError.value ? (
          <Banner tone="error">{store.lastError.value}</Banner>
        ) : null}
        <RouteView />
      </main>
      <nav class="mobile-nav" aria-label="Primary (mobile)">
        {NAV.filter((n) => n.name !== 'settings' && n.name !== 'research').map((n) => (
          <a
            key={n.name}
            href={hrefFor(n.name)}
            aria-current={route.name === n.name ? 'page' : undefined}
          >
            {n.icon}
            {n.label}
          </a>
        ))}
      </nav>
      <Toasts />
      <VoiceDialog />
    </div>
  );
}

function RouteView() {
  const { router } = useApp();
  const route = router.route.value;
  switch (route.name) {
    case 'tasks':
      return (
        <TasksView key={route.params.get('q') ?? ''} initialQuery={route.params.get('q') ?? ''} />
      );
    case 'notes':
      return <NotesView noteId={route.id} initialQuery={route.params.get('q') ?? ''} />;
    case 'projects':
      return <ProjectsView projectId={route.id} />;
    case 'research':
      return <ResearchView initialQuery={route.params.get('q') ?? ''} />;
    case 'assistant':
      return <AssistantView />;
    case 'settings':
      return <SettingsView />;
    case 'spatial':
      return <SpatialView />;
    case 'home':
    default:
      return <HomeView />;
  }
}

function Toasts() {
  const { toaster } = useApp();
  const toasts = toaster.toasts.value;
  if (toasts.length === 0) return null;
  return (
    <div class="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div
          key={t.id}
          class={`toast toast-${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
          data-testid="toast"
        >
          <span class="grow">{t.message}</span>
          {t.action ? (
            <button
              type="button"
              class="btn btn-sm"
              onClick={() => {
                t.action?.run();
                toaster.dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            class="icon-btn"
            aria-label="Dismiss"
            onClick={() => toaster.dismiss(t.id)}
            style={{ width: 32, height: 32 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
