import { useEffect, useState } from 'preact/hooks';
import type { Project, ProjectColor, ProjectStatus, Task } from '../../domain/types';
import { PROJECT_COLORS } from '../../domain/types';
import { projectProgress, sortTasks } from '../../domain/queries';
import type { FieldErrors } from '../../domain/validation';
import { AssistError, friendlyAssistMessage } from '../../ai/client';
import type { ProjectStep } from '../../ai/schemas';
import { useApp } from '../context';
import {
  ArrowLeftIcon,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  FolderIcon,
  PlusIcon,
  ProgressBar,
  SparkIcon,
} from '../components/ui';
import { TaskDialog } from './TaskDialog';
import { TaskItem } from './TaskItem';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};

export function ProjectsView(props: { projectId: string | null }) {
  const { store, router } = useApp();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const projects = store.projects.value;
  const tasks = store.tasks.value;
  const selected = props.projectId ? store.getProject(props.projectId) : undefined;

  if (props.projectId && !selected) {
    return (
      <EmptyState
        title="Project not found"
        body="It may have been deleted."
        action={<Button onClick={() => router.navigate('projects')}>Back to projects</Button>}
      />
    );
  }
  if (selected) {
    return (
      <ProjectDetail
        project={selected}
        onEdit={() => {
          setEditing(selected);
          setDialogOpen(true);
        }}
        dialog={
          <ProjectDialog open={dialogOpen} project={editing} onClose={() => setDialogOpen(false)} />
        }
      />
    );
  }

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <h1>Projects</h1>
          <span class="muted small">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </span>
        </div>
        <div class="topbar-actions">
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="new-project"
          >
            New project
          </Button>
        </div>
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderIcon />}
          title="No projects yet"
          body="Projects group tasks, notes and research around one goal and show real progress from the tasks you complete."
          action={
            <Button
              variant="primary"
              icon={<PlusIcon />}
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              Create a project
            </Button>
          }
        />
      ) : (
        <div class="card-grid">
          {projects.map((p) => {
            const progress = projectProgress(p, tasks);
            return (
              <a
                key={p.id}
                href={`#/projects/${encodeURIComponent(p.id)}`}
                class="card stack"
                style={{ textDecoration: 'none', color: 'inherit', gap: 10 }}
                data-testid="project-card"
              >
                <div class="row row-between">
                  <span class="row">
                    <span class={`dot dot-${p.color}`} aria-hidden="true" />
                    <strong>{p.name}</strong>
                  </span>
                  <Badge
                    tone={
                      p.status === 'active'
                        ? 'accent'
                        : p.status === 'completed'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {STATUS_LABEL[p.status]}
                  </Badge>
                </div>
                {p.description ? (
                  <p
                    class="small muted"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {p.description}
                  </p>
                ) : null}
                <ProgressBar ratio={progress.ratio} label={`${p.name} progress`} />
                <span class="small muted">
                  {progress.total === 0
                    ? 'No tasks yet'
                    : `${progress.done} of ${progress.total} tasks done`}
                  {progress.overdue > 0 ? ` · ${progress.overdue} overdue` : ''}
                </span>
              </a>
            );
          })}
        </div>
      )}
      <ProjectDialog open={dialogOpen} project={editing} onClose={() => setDialogOpen(false)} />
    </>
  );
}

function ProjectDetail(props: {
  project: Project;
  onEdit: () => void;
  dialog: preact.ComponentChildren;
}) {
  const { store, router, toaster, assistant } = useApp();
  const p = props.project;
  const tasks = sortTasks(
    store.tasks.value.filter((t) => t.projectId === p.id),
    'due',
  );
  const notes = store.notes.value.filter((n) => n.projectId === p.id);
  const research = store.research.value.filter((r) => r.projectId === p.id);
  const progress = projectProgress(p, store.tasks.value);
  const [taskDialog, setTaskDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cascade, setCascade] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [steps, setSteps] = useState<ProjectStep[] | null>(null);

  const breakDown = async () => {
    setPlanning(true);
    try {
      const r = await assistant.breakDownProject(p, tasks);
      setSteps(r.result.steps);
    } catch (e) {
      if (!(e instanceof AssistError && e.code === 'cancelled'))
        toaster.show('error', friendlyAssistMessage(e));
    } finally {
      setPlanning(false);
    }
  };
  const addStep = (s: ProjectStep) => {
    const r = store.createTask({
      title: s.title,
      description: s.description,
      priority: s.priority,
      projectId: p.id,
    });
    if (r.ok) {
      toaster.show('success', `Task "${r.value.title}" added to ${p.name}`);
      setSteps((cur) => cur?.filter((x) => x !== s) ?? null);
    } else toaster.show('error', Object.values(r.errors)[0] ?? 'Could not add the task');
  };
  const removeProject = () => {
    store.deleteProject(p.id, { cascade });
    setDeleting(false);
    toaster.show(
      'info',
      cascade
        ? `Deleted "${p.name}" and its records`
        : `Deleted "${p.name}". Its records were kept.`,
    );
    router.navigate('projects');
  };

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <a href="#/projects" class="row small muted" style={{ textDecoration: 'none' }}>
            <ArrowLeftIcon /> Projects
          </a>
          <h1 class="row">
            <span class={`dot dot-${p.color}`} aria-hidden="true" /> {p.name}
          </h1>
          <span class="muted small">
            {STATUS_LABEL[p.status]}
            {p.description ? ` · ${p.description}` : ''}
          </span>
        </div>
        <div class="topbar-actions">
          <Button onClick={props.onEdit} data-testid="project-edit">
            Edit
          </Button>
          <Button
            icon={<SparkIcon />}
            busy={planning}
            onClick={breakDown}
            data-testid="project-plan"
          >
            Suggest next steps
          </Button>
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => {
              setEditingTask(null);
              setTaskDialog(true);
            }}
            data-testid="project-new-task"
          >
            Add task
          </Button>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi">
          <div class="kpi-value">
            {progress.total === 0 ? '—' : `${Math.round(progress.ratio * 100)}%`}
          </div>
          <div class="kpi-label">Complete</div>
        </div>
        <div class="kpi">
          <div class="kpi-value">{progress.open}</div>
          <div class="kpi-label">Open tasks</div>
        </div>
        <div class="kpi">
          <div class="kpi-value" style={{ color: progress.overdue ? 'var(--danger)' : undefined }}>
            {progress.overdue}
          </div>
          <div class="kpi-label">Overdue</div>
        </div>
        <div class="kpi">
          <div class="kpi-value">{notes.length + research.length}</div>
          <div class="kpi-label">Notes &amp; research</div>
        </div>
      </div>
      <ProgressBar ratio={progress.ratio} label="Project progress" />

      <section class="section" style={{ marginTop: 24 }}>
        <div class="section-head">
          <h2>Tasks</h2>
        </div>
        {tasks.length === 0 ? (
          <p class="muted">
            No tasks in this project yet. Add one, or ask the assistant to suggest next steps.
          </p>
        ) : (
          <ul class="list" aria-label={`Tasks in ${p.name}`}>
            {tasks.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                showProject={false}
                onEdit={(x) => {
                  setEditingTask(x);
                  setTaskDialog(true);
                }}
                onDelete={setDeletingTask}
              />
            ))}
          </ul>
        )}
      </section>
      <div class="split">
        <section class="section">
          <div class="section-head">
            <h2>Notes</h2>
          </div>
          {notes.length === 0 ? (
            <p class="muted">No notes linked. Set a note's project to link it here.</p>
          ) : (
            <ul class="list">
              {notes.map((n) => (
                <li key={n.id} class="item">
                  <a
                    href={`#/notes/${encodeURIComponent(n.id)}`}
                    class="item-title"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {n.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section class="section">
          <div class="section-head">
            <h2>Research</h2>
          </div>
          {research.length === 0 ? (
            <p class="muted">No research linked yet.</p>
          ) : (
            <ul class="list">
              {research.map((r) => (
                <li key={r.id} class="item">
                  <div class="item-main">
                    <span class="item-title">{r.title}</span>
                    {r.url ? (
                      <a
                        class="small truncate"
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {r.url}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div class="row" style={{ marginTop: 8 }}>
        <Button variant="danger" onClick={() => setDeleting(true)} data-testid="project-delete">
          Delete project
        </Button>
      </div>

      <TaskDialog
        open={taskDialog}
        task={editingTask}
        initial={{ projectId: p.id }}
        onClose={() => setTaskDialog(false)}
      />
      <ConfirmDialog
        open={deletingTask !== null}
        title="Delete task?"
        message={deletingTask ? `"${deletingTask.title}" will be removed.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deletingTask) store.deleteTask(deletingTask.id);
          setDeletingTask(null);
        }}
        onCancel={() => setDeletingTask(null)}
      />
      <Dialog
        open={deleting}
        title="Delete project?"
        onClose={() => setDeleting(false)}
        testId="confirm-dialog"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" onClick={removeProject} data-testid="confirm-accept">
              Delete project
            </Button>
          </>
        }
      >
        <p>
          “{p.name}” has {tasks.length} tasks, {notes.length} notes and {research.length} research
          items linked to it.
        </p>
        <label class="row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            class="checkbox"
            checked={cascade}
            onChange={(e) => setCascade(e.currentTarget.checked)}
          />
          <span>Also delete the linked tasks, notes and research</span>
        </label>
        {!cascade ? (
          <p class="small muted">Linked records will be kept and unlinked.</p>
        ) : (
          <p class="small" style={{ color: 'var(--danger)' }}>
            This cannot be undone.
          </p>
        )}
      </Dialog>
      <Dialog
        open={steps !== null}
        title="Suggested next steps"
        onClose={() => setSteps(null)}
        testId="plan-dialog"
      >
        <p class="ai-mark">
          <SparkIcon /> Generated from the project description and existing tasks. Add only the ones
          you want.
        </p>
        {steps?.map((s, i) => (
          <div key={`${i}-${s.title}`} class="card suggestion stack" style={{ gap: 6 }}>
            <strong>
              {i + 1}. {s.title}
            </strong>
            {s.description ? <p class="small muted">{s.description}</p> : null}
            <div class="row small muted">
              <span>Priority: {s.priority}</span>
              <Button
                class="btn-sm"
                variant="primary"
                style={{ marginLeft: 'auto' }}
                onClick={() => addStep(s)}
              >
                Add task
              </Button>
            </div>
          </div>
        ))}
        {steps && steps.length === 0 ? <p class="muted">All suggestions have been added.</p> : null}
      </Dialog>
      {props.dialog}
    </>
  );
}

export function ProjectDialog(props: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSaved?: (p: Project) => void;
}) {
  const { store, toaster } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [color, setColor] = useState<ProjectColor>('indigo');
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => {
    if (!props.open) return;
    setName(props.project?.name ?? '');
    setDescription(props.project?.description ?? '');
    setStatus(props.project?.status ?? 'active');
    setColor(
      props.project?.color ??
        PROJECT_COLORS[store.projects.value.length % PROJECT_COLORS.length] ??
        'indigo',
    );
    setErrors({});
  }, [props.open, props.project]);
  const submit = (e: Event) => {
    e.preventDefault();
    const input = { name, description, status, color };
    const r = props.project
      ? store.updateProject(props.project.id, input)
      : store.createProject(input);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    toaster.show('success', props.project ? 'Project updated' : 'Project created');
    props.onSaved?.(r.value);
    props.onClose();
  };
  return (
    <Dialog
      open={props.open}
      title={props.project ? 'Edit project' : 'New project'}
      onClose={props.onClose}
      testId="project-dialog"
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="project-form" data-testid="project-save">
            {props.project ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="project-form" class="stack" onSubmit={submit} noValidate>
        <Field label="Name" id="project-name" error={errors.name} required>
          <input
            id="project-name"
            class="input"
            value={name}
            maxLength={200}
            autoFocus
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </Field>
        <Field label="Description" id="project-desc" error={errors.description}>
          <textarea
            id="project-desc"
            class="textarea"
            value={description}
            maxLength={4000}
            onInput={(e) => setDescription(e.currentTarget.value)}
          />
        </Field>
        <div class="form-grid">
          <Field label="Status" id="project-status">
            <select
              id="project-status"
              class="select"
              value={status}
              onChange={(e) => setStatus(e.currentTarget.value as ProjectStatus)}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </Field>
          <Field label="Colour" id="project-color">
            <select
              id="project-color"
              class="select"
              value={color}
              onChange={(e) => setColor(e.currentTarget.value as ProjectColor)}
            >
              {PROJECT_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c[0]!.toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
