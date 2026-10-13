import { useState } from 'preact/hooks';
import type { Task } from '../../domain/types';
import { isDueToday, isOverdue, projectProgress, sortTasks } from '../../domain/queries';
import { useApp } from '../context';
import {
  Button,
  EmptyState,
  HeadsetIcon,
  MicIcon,
  PlusIcon,
  ProgressBar,
  formatRelative,
} from '../components/ui';
import { TaskDialog } from './TaskDialog';
import { TaskItem } from './TaskItem';
import { ProjectDialog } from './ProjectsView';

export function HomeView() {
  const { store, router, voiceOpen, speech } = useApp();
  const [taskDialog, setTaskDialog] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const tasks = store.tasks.value;
  const open = store.openTasks.value;
  const overdue = open.filter((t) => isOverdue(t));
  const today = open.filter((t) => isDueToday(t));
  const focus = sortTasks(open, 'due').slice(0, 6);
  const notes = [...store.notes.value]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  const projects = store.projects.value.filter((p) => p.status === 'active').slice(0, 4);

  if (store.isEmpty) {
    return (
      <>
        <div class="topbar">
          <div class="topbar-title">
            <h1>Welcome to SpatialDesk</h1>
            <span class="muted">
              Your tasks, notes, projects and research in one workspace, in the browser and in mixed
              reality.
            </span>
          </div>
        </div>
        <EmptyState
          title="Start your workspace"
          body="Everything you add is stored on this device. Create a task to get going, or open the spatial workspace on a Meta Quest."
          action={
            <div class="row" style={{ justifyContent: 'center' }}>
              <Button
                variant="primary"
                icon={<PlusIcon />}
                onClick={() => setTaskDialog(true)}
                data-testid="home-new-task"
              >
                Create a task
              </Button>
              <Button onClick={() => setProjectDialog(true)}>Create a project</Button>
              <Button icon={<HeadsetIcon />} onClick={() => router.navigate('spatial')}>
                Spatial workspace
              </Button>
            </div>
          }
        />
        <TaskDialog open={taskDialog} onClose={() => setTaskDialog(false)} />
        <ProjectDialog
          open={projectDialog}
          project={null}
          onClose={() => setProjectDialog(false)}
        />
      </>
    );
  }

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <h1>Workspace</h1>
          <span class="muted small">{greeting()}</span>
        </div>
        <div class="topbar-actions">
          {speech.available ? (
            <Button
              icon={<MicIcon />}
              onClick={() => (voiceOpen.value = true)}
              data-testid="home-voice"
            >
              Voice
            </Button>
          ) : null}
          <Button icon={<HeadsetIcon />} onClick={() => router.navigate('spatial')}>
            Spatial workspace
          </Button>
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => {
              setEditing(null);
              setTaskDialog(true);
            }}
            data-testid="home-new-task"
          >
            New task
          </Button>
        </div>
      </div>
      <div class="kpis" aria-label="Workspace summary">
        <div class="kpi">
          <div class="kpi-value">{open.length}</div>
          <div class="kpi-label">Open tasks</div>
        </div>
        <div class="kpi">
          <div class="kpi-value" style={{ color: overdue.length ? 'var(--danger)' : undefined }}>
            {overdue.length}
          </div>
          <div class="kpi-label">Overdue</div>
        </div>
        <div class="kpi">
          <div class="kpi-value">{today.length}</div>
          <div class="kpi-label">Due today</div>
        </div>
        <div class="kpi">
          <div class="kpi-value">{tasks.length - open.length}</div>
          <div class="kpi-label">Completed</div>
        </div>
      </div>
      <div class="split">
        <section class="section">
          <div class="section-head">
            <h2>Up next</h2>
            <a href="#/tasks" class="small">
              All tasks
            </a>
          </div>
          {focus.length === 0 ? (
            <p class="muted">No open tasks. Nice.</p>
          ) : (
            <ul class="list" aria-label="Upcoming tasks">
              {focus.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  onEdit={(x) => {
                    setEditing(x);
                    setTaskDialog(true);
                  }}
                  onDelete={(x) => store.deleteTask(x.id)}
                />
              ))}
            </ul>
          )}
        </section>
        <div class="stack">
          <section class="section">
            <div class="section-head">
              <h2>Projects</h2>
              <a href="#/projects" class="small">
                All projects
              </a>
            </div>
            {projects.length === 0 ? (
              <p class="muted">No active projects.</p>
            ) : (
              <div class="stack">
                {projects.map((p) => {
                  const progress = projectProgress(p, tasks);
                  return (
                    <a
                      key={p.id}
                      href={`#/projects/${encodeURIComponent(p.id)}`}
                      class="card stack"
                      style={{ gap: 8, textDecoration: 'none', color: 'inherit' }}
                    >
                      <span class="row">
                        <span class={`dot dot-${p.color}`} aria-hidden="true" />
                        <strong>{p.name}</strong>
                        <span class="small muted" style={{ marginLeft: 'auto' }}>
                          {progress.total === 0 ? 'no tasks' : `${progress.done}/${progress.total}`}
                        </span>
                      </span>
                      <ProgressBar ratio={progress.ratio} label={`${p.name} progress`} />
                    </a>
                  );
                })}
              </div>
            )}
          </section>
          <section class="section">
            <div class="section-head">
              <h2>Recent notes</h2>
              <a href="#/notes" class="small">
                All notes
              </a>
            </div>
            {notes.length === 0 ? (
              <p class="muted">No notes yet.</p>
            ) : (
              <ul class="list">
                {notes.map((n) => (
                  <li key={n.id} class="item">
                    <div class="item-main">
                      <a
                        href={`#/notes/${encodeURIComponent(n.id)}`}
                        class="item-title truncate"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {n.title}
                      </a>
                      <span class="small faint">Edited {formatRelative(n.updatedAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <TaskDialog open={taskDialog} task={editing} onClose={() => setTaskDialog(false)} />
    </>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Working late.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}
