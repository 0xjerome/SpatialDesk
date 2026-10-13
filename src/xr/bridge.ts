import type { Signal } from '@preact/signals-core';
import type { WorkspaceStore } from '../domain/store';
import type { SpeechProvider } from '../voice/provider';

/**
 * What the immersive workspace needs from the rest of the app. Passed through
 * `world.globals.spatialdesk` so ECS systems never import UI code.
 */
export interface XrBridge {
  store: WorkspaceStore;
  speech: SpeechProvider;
  /** Called when the user presses Exit while not in an immersive session. */
  onExitRequested: () => void;
  /** Mirror of the session phase for panels that want to show it. */
  immersive: Signal<boolean>;
}

export const BRIDGE_KEY = 'spatialdesk';
