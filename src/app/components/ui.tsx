import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/* ------------------------------- Buttons -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    busy?: boolean;
    icon?: ComponentChildren;
  },
) {
  const {
    variant = 'secondary',
    busy = false,
    icon,
    children,
    class: cls,
    className,
    disabled,
    type = 'button',
    ...rest
  } = props;
  return (
    <button
      type={type}
      {...rest}
      class={['btn', `btn-${variant}`, cls ?? className ?? ''].join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span class="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

/* -------------------------------- Fields -------------------------------- */

export function Field(props: {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  children: ComponentChildren;
  required?: boolean;
}) {
  return (
    <div class={`field${props.error ? ' field-invalid' : ''}`}>
      <label for={props.id} class="field-label">
        {props.label}
        {props.required ? <span class="field-required"> *</span> : null}
      </label>
      {props.children}
      {props.error ? (
        <p class="field-error" id={`${props.id}-error`} role="alert">
          {props.error}
        </p>
      ) : props.hint ? (
        <p class="field-hint" id={`${props.id}-hint`}>
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------- Dialog -------------------------------- */

export function Dialog(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (props.open && !el.open) el.showModal();
    else if (!props.open && el.open) el.close();
  }, [props.open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      props.onClose();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [props.onClose]);
  if (!props.open) return null;
  return (
    <dialog
      ref={ref}
      class={`dialog${props.wide ? ' dialog-wide' : ''}`}
      aria-labelledby="dialog-title"
      data-testid={props.testId}
    >
      <div class="dialog-head">
        <h2 id="dialog-title" class="dialog-title">
          {props.title}
        </h2>
        <button type="button" class="icon-btn" aria-label="Close dialog" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </div>
      <div class="dialog-body">{props.children}</div>
      {props.footer ? <div class="dialog-foot">{props.footer}</div> : null}
    </dialog>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: ComponentChildren;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      title={props.title}
      onClose={props.onCancel}
      testId="confirm-dialog"
      footer={
        <>
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button
            variant={props.danger ? 'danger' : 'primary'}
            onClick={props.onConfirm}
            data-testid="confirm-accept"
          >
            {props.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p>{props.message}</p>
    </Dialog>
  );
}

/* ----------------------------- Small pieces ----------------------------- */

export function EmptyState(props: {
  title: string;
  body: ComponentChildren;
  action?: ComponentChildren;
  icon?: ComponentChildren;
}) {
  return (
    <div class="empty" role="status">
      {props.icon ? <div class="empty-icon">{props.icon}</div> : null}
      <h3 class="empty-title">{props.title}</h3>
      <p class="empty-body">{props.body}</p>
      {props.action ? <div class="empty-action">{props.action}</div> : null}
    </div>
  );
}

export function Badge(props: {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'low' | 'medium' | 'high';
  children: ComponentChildren;
  title?: string;
}) {
  return (
    <span class={`badge badge-${props.tone ?? 'neutral'}`} title={props.title}>
      {props.children}
    </span>
  );
}

export function ProgressBar(props: { ratio: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, props.ratio)) * 100);
  return (
    <div
      class="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={props.label}
    >
      <div class="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SearchInput(props: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  id?: string;
  label: string;
}) {
  return (
    <div class="search">
      <SearchIcon />
      <input
        id={props.id}
        type="search"
        class="input"
        value={props.value}
        placeholder={props.placeholder ?? 'Search'}
        aria-label={props.label}
        onInput={(e) => props.onInput((e.currentTarget as HTMLInputElement).value)}
      />
    </div>
  );
}

export function Banner(props: {
  tone: 'info' | 'warning' | 'error' | 'success';
  children: ComponentChildren;
  testId?: string;
}) {
  return (
    <div
      class={`banner banner-${props.tone}`}
      role={props.tone === 'error' ? 'alert' : 'status'}
      data-testid={props.testId}
    >
      {props.children}
    </div>
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

/* --------------------------------- Icons -------------------------------- */

const svg = (d: string, size = 18) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
export const CloseIcon = () => svg('M18 6 6 18M6 6l12 12');
export const SearchIcon = () => svg('M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z');
export const PlusIcon = () => svg('M12 5v14M5 12h14');
export const CheckIcon = () => svg('M20 6 9 17l-5-5');
export const TrashIcon = () => svg('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6');
export const EditIcon = () => svg('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z');
export const MicIcon = () =>
  svg(
    'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  );
export const SparkIcon = () =>
  svg(
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  );
export const HeadsetIcon = () =>
  svg('M3 12a9 9 0 0 1 18 0v5a3 3 0 0 1-3 3h-2v-7h5M3 12v5a3 3 0 0 0 3 3h2v-7H3');
export const LinkIcon = () =>
  svg('M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1');
export const HomeIcon = () => svg('M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z');
export const TaskIcon = () =>
  svg('M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11');
export const NoteIcon = () =>
  svg('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8');
export const FolderIcon = () =>
  svg('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z');
export const BookIcon = () =>
  svg('M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z');
export const SettingsIcon = () =>
  svg(
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  );
export const ArrowLeftIcon = () => svg('M19 12H5M12 19l-7-7 7-7');
export const UndoIcon = () => svg('M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13');
