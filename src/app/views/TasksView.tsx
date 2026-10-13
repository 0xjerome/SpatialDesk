import { useMemo, useState } from 'preact/hooks';
import type { Task, TaskPriority } from '../../domain/types';
import { filterTasks, sortTasks, type TaskSort, type TaskStatusFilter } from '../../domain/queries';
import { useApp } from '../context';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  PlusIcon,
  SearchInput,
  TaskIcon,
} from '../components/ui';
import { TaskDialog } from './TaskDialog';
import { TaskItem } from './TaskItem';

export function TasksView(props: { initialQuery?: string }) {
  const { store, router, toaster } = useApp();
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [status, setStatus] = useState<TaskStatusFilter>('open');
  const [priority, setPriority] = useState<TaskPriority | 'all'>('all');
  const [projectId, setProjectId] = useState<string>('all');
  const [sort, setSort] = useState<TaskSort>('created');
  const [editing, setEditing] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Task | null>(null);

  const tasks = store.tasks.value;
  const projects = store.projects.value;
  const visible = useMemo(
    () => sortTasks(filterTasks(tasks, { query, status, priority, projectId }), sort),
    [tasks, query, status, priority, projectId, sort],
  );
  const hasFilters = query !== '' || status !== 'open' || priority !== 'all' || projectId !== 'all';

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (t: Task) => {
    setEditing(t);
    setDialogOpen(true);
  };
  const confirmDelete = () => {
    if (deleting) {
      const snapshot = deleting;
      store.deleteTask(snapshot.id);
      toaster.show('info', `Deleted "${snapshot.title}"`, {
        label: 'Undo',
        run: () => store.importData({ tasks: [snapshot] }, 'merge'),
      });
    }
    setDeleting(null);
  };

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <h1>Tasks</h1>
          <span class="muted small">
            {store.openTasks.value.length} open · {tasks.length - store.openTasks.value.length} done
          </span>
        </div>
        <div class="topbar-actions">
          <Button variant="primary" icon={<PlusIcon />} onClick={openNew} data-testid="new-task">
            New task
          </Button>
        </div>
      </div>

      {tasks.length > 0 ? (
        <div class="toolbar" role="search">
          <SearchInput
            value={query}
            onInput={setQuery}
            label="Search tasks"
            placeholder="Search tasks"
            id="task-search"
          />
          <select
            class="select"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.currentTarget.value as TaskStatusFilter)}
          >
            <option value="open">Open</option>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </select>
          <select
            class="select"
            aria-label="Filter by priority"
            value={priority}
            onChange={(e) => setPriority(e.currentTarget.value as TaskPriority | 'all')}
          >
            <option value="all">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          {projects.length > 0 ? (
            <select
              class="select"
              aria-label="Filter by project"
              value={projectId}
              onChange={(e) => setProjectId(e.currentTarget.value)}
            >
              <option value="all">Any project</option>
              <option value="none">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <select
            class="select"
            aria-label="Sort tasks"
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value as TaskSort)}
          >
            <option value="created">Newest</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="title">Title</option>
          </select>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState
          icon={<TaskIcon />}
          title="No tasks yet"
          body="Capture what needs doing. Tasks can carry a priority, a due date and a project, and they stay on this device."
          action={
            <Button variant="primary" icon={<PlusIcon />} onClick={openNew}>
              Create your first task
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body={hasFilters ? 'Try a different search or clear the filters.' : 'All caught up.'}
          action={
            hasFilters ? (
              <Button
                onClick={() => {
                  setQuery('');
                  setStatus('open');
                  setPriority('all');
                  setProjectId('all');
                }}
              >
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <ul class="list" aria-label="Task list">
          {visible.map((t) => (
            <TaskItem key={t.id} task={t} onEdit={openEdit} onDelete={setDeleting} />
          ))}
        </ul>
      )}

      <TaskDialog open={dialogOpen} task={editing} onClose={() => setDialogOpen(false)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete task?"
        message={
          deleting
            ? `"${deleting.title}" will be removed. You can undo this for a few seconds.`
            : ''
        }
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      {projects.length === 0 && tasks.length > 3 ? (
        <p class="muted small" style={{ marginTop: 16 }}>
          Tip: group related tasks by creating a{' '}
          <a
            href="#/projects"
            onClick={(e) => {
              e.preventDefault();
              router.navigate('projects');
            }}
          >
            project
          </a>
          .
        </p>
      ) : null}
    </>
  );
}
