import type { Task } from '../../domain/types';
import { isDueToday, isOverdue } from '../../domain/queries';
import { useApp } from '../context';
import { Badge, EditIcon, TrashIcon, formatDate } from '../components/ui';

const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const;
const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done' } as const;

export function TaskItem(props: {
  task: Task;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  showProject?: boolean;
}) {
  const { store, toaster } = useApp();
  const t = props.task;
  const project = t.projectId ? store.getProject(t.projectId) : undefined;
  const overdue = isOverdue(t);
  const today = isDueToday(t);
  const toggle = () => {
    const r = store.toggleTaskDone(t.id);
    if (r.ok)
      toaster.show(
        'success',
        r.value.status === 'done' ? `Completed "${t.title}"` : `Reopened "${t.title}"`,
      );
    else toaster.show('error', Object.values(r.errors)[0] ?? 'Could not update the task');
  };
  return (
    <li
      class={`item${t.status === 'done' ? ' item-done' : ''}`}
      data-testid="task-item"
      data-task-id={t.id}
    >
      <input
        type="checkbox"
        class="checkbox"
        checked={t.status === 'done'}
        onChange={toggle}
        aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Complete ${t.title}`}
        style={{ marginTop: 2 }}
      />
      <div class="item-main">
        <button
          type="button"
          class="item-title-btn truncate"
          onClick={() => props.onEdit(t)}
          data-testid="task-title"
        >
          {t.title}
        </button>
        {t.description ? <p class="small muted truncate">{t.description}</p> : null}
        <div class="item-meta">
          <Badge tone={t.priority}>{PRIORITY_LABEL[t.priority]}</Badge>
          {t.status === 'in_progress' ? (
            <Badge tone="accent">{STATUS_LABEL[t.status]}</Badge>
          ) : null}
          {t.dueDate ? (
            <Badge
              tone={overdue ? 'danger' : today ? 'warning' : 'neutral'}
              title={overdue ? 'Overdue' : today ? 'Due today' : 'Due date'}
            >
              {overdue ? 'Overdue · ' : today ? 'Today · ' : 'Due '}
              {formatDate(t.dueDate)}
            </Badge>
          ) : null}
          {props.showProject !== false && project ? (
            <span class="row small">
              <span class={`dot dot-${project.color}`} aria-hidden="true" />
              {project.name}
            </span>
          ) : null}
        </div>
      </div>
      <div class="item-actions">
        <button
          type="button"
          class="icon-btn"
          aria-label={`Edit ${t.title}`}
          onClick={() => props.onEdit(t)}
        >
          <EditIcon />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label={`Delete ${t.title}`}
          onClick={() => props.onDelete(t)}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}
