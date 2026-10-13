import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { signal, type Signal } from '@preact/signals-core';
import type { AssistantClient } from '../ai/client';
import type { WorkspaceStore } from '../domain/store';
import type { SpeechProvider } from '../voice/provider';
import type { XrController } from '../xr/controller';
import type { Router } from './router';

export type ToastKind = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional one-off action, e.g. Undo. */
  action?: { label: string; run: () => void };
}

export class Toaster {
  readonly toasts = signal<readonly Toast[]>([]);
  private counter = 0;
  show(
    kind: ToastKind,
    message: string,
    action?: Toast['action'],
    ttlMs = kind === 'error' ? 8000 : 4000,
  ): void {
    const id = ++this.counter;
    this.toasts.value = [...this.toasts.value, { id, kind, message, action }];
    setTimeout(() => this.dismiss(id), ttlMs);
  }
  dismiss(id: number): void {
    this.toasts.value = this.toasts.value.filter((t) => t.id !== id);
  }
}

export interface AppServices {
  store: WorkspaceStore;
  assistant: AssistantClient;
  speech: SpeechProvider;
  router: Router;
  toaster: Toaster;
  xr: XrController;
  /** Whether the voice dialog is open; shared so XR and 2D can both trigger it. */
  voiceOpen: Signal<boolean>;
}

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext is missing. Wrap the tree in <AppContext.Provider>.');
  return ctx;
}
