import { useEffect, useState } from 'preact/hooks';
import type { Task, TaskPriority, TaskStatus } from '../../domain/types';
import type { FieldErrors, TaskInput } from '../../domain/validation';
import { useApp } from '../context';
import { Button, Dialog, Field } from '../components/ui';

export interface TaskDialogProps {
  open: boolean;
  task?: Task | null;
  /** Pre-fill for a new task (e.g. from a project page or an AI suggestion). */
  initial?: Partial<TaskInput>;
  onClose: () => void;
  onSaved?: (task: Task) => void;
}

export function TaskDialog(props: TaskDialogProps) {
  const { store, toaster } = useApp();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [projectId, setProjectId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const projects = store.projects.value;

  useEffect(() => {
    if (!props.open) return;
    const t = props.task;
    setTitle(t?.title ?? props.initial?.title ?? '');
    setDescription(t?.description ?? props.initial?.description ?? '');
    setStatus(t?.status ?? props.initial?.status ?? 'todo');
    setPriority(t?.priority ?? props.initial?.priority ?? 'medium');
    setDueDate(t?.dueDate ?? props.initial?.dueDate ?? '');
    setProjectId(t?.projectId ?? props.initial?.projectId ?? '');
    setErrors({});
    setSaving(false);
  }, [props.open, props.task, props.initial]);

  const submit = (e: Event) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const input: TaskInput = {
      title,
      description,
      status,
      priority,
      dueDate: dueDate || null,
      projectId: projectId || null,
    };
    const result = props.task ? store.updateTask(props.task.id, input) : store.createTask(input);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toaster.show('success', props.task ? 'Task updated' : 'Task created');
    props.onSaved?.(result.value);
    props.onClose();
  };

  return (
    <Dialog
      open={props.open}
      title={props.task ? 'Edit task' : 'New task'}
      onClose={props.onClose}
      testId="task-dialog"
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="task-form"
            busy={saving}
            data-testid="task-save"
          >
            {props.task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <form id="task-form" class="stack" onSubmit={submit} noValidate>
        <Field label="Title" id="task-title" error={errors.title} required>
          <input
            id="task-title"
            class="input"
            value={title}
            maxLength={200}
            autoFocus
            onInput={(e) => setTitle(e.currentTarget.value)}
            aria-invalid={!!errors.title}
          />
        </Field>
        <Field label="Description" id="task-desc" error={errors.description}>
          <textarea
            id="task-desc"
            class="textarea"
            value={description}
            maxLength={4000}
            onInput={(e) => setDescription(e.currentTarget.value)}
          />
        </Field>
        <div class="form-grid">
          <Field label="Status" id="task-status" error={errors.status}>
            <select
              id="task-status"
              class="select"
              value={status}
              onChange={(e) => setStatus(e.currentTarget.value as TaskStatus)}
            >
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </Field>
          <Field label="Priority" id="task-priority" error={errors.priority}>
            <select
              id="task-priority"
              class="select"
              value={priority}
              onChange={(e) => setPriority(e.currentTarget.value as TaskPriority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Due date" id="task-due" error={errors.dueDate}>
            <input
              id="task-due"
              class="input"
              type="date"
              value={dueDate}
              onInput={(e) => setDueDate(e.currentTarget.value)}
            />
          </Field>
          <Field label="Project" id="task-project" error={errors.projectId}>
            <select
              id="task-project"
              class="select"
              value={projectId}
              onChange={(e) => setProjectId(e.currentTarget.value)}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
