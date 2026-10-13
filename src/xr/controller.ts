import { signal } from '@preact/signals-core';
import type { WorkspaceStore } from '../domain/store';
import type { SpeechProvider } from '../voice/provider';
import type { XrBridge } from './bridge';
import type { createWorkspaceWorld } from './world';

export interface XrSupport {
  checked: boolean;
  secureContext: boolean;
  webgl: boolean;
  xrApi: boolean;
  immersiveAr: boolean;
  immersiveVr: boolean;
  /** True when the IWSDK/IWER emulator is providing navigator.xr (dev only). */
  emulated: boolean;
  questBrowser: boolean;
}

export type XrPhase = 'idle' | 'loading' | 'preview' | 'requesting' | 'immersive' | 'error';
export type XrMode = 'immersive-ar' | 'immersive-vr';

type WorldHandle = Awaited<ReturnType<typeof createWorkspaceWorld>>;

/**
 * Owns the lifecycle of the immersive workspace: capability detection, lazy
 * creation of the IWSDK world, entering and leaving XR, and teardown.
 */
export class XrController {
  readonly support = signal<XrSupport>({
    checked: false,
    secureContext: false,
    webgl: false,
    xrApi: false,
    immersiveAr: false,
    immersiveVr: false,
    emulated: false,
    questBrowser: false,
  });
  readonly phase = signal<XrPhase>('idle');
  readonly error = signal<string | null>(null);
  readonly mode = signal<XrMode | null>(null);
  readonly immersive = signal(false);
  /** Number of immersive sessions started in this page lifetime (for diagnostics). */
  readonly sessionsStarted = signal(0);

  private handle: WorldHandle | null = null;
  private loading: Promise<WorldHandle> | null = null;
  private unsubscribeVisibility: (() => void) | null = null;

  constructor(
    private readonly deps: {
      store: WorkspaceStore;
      speech: SpeechProvider;
      container: () => HTMLElement | null;
    },
  ) {}

  get world() {
    return this.handle?.world ?? null;
  }
  get panels() {
    return this.handle?.panels ?? null;
  }

  async detect(): Promise<XrSupport> {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const xr = nav?.xr;
    const result: XrSupport = {
      checked: true,
      secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
      webgl: hasWebGL(),
      xrApi: Boolean(xr),
      immersiveAr: false,
      immersiveVr: false,
      emulated: typeof window !== 'undefined' && 'IWER_DEVICE' in window,
      questBrowser: /OculusBrowser/i.test(nav?.userAgent ?? ''),
    };
    if (xr) {
      const check = async (mode: XRSessionMode) => {
        try {
          return await xr.isSessionSupported(mode);
        } catch {
          return false;
        }
      };
      [result.immersiveAr, result.immersiveVr] = await Promise.all([
        check('immersive-ar'),
        check('immersive-vr'),
      ]);
    }
    this.support.value = result;
    return result;
  }

  /** Human readable reason why immersive mode cannot start, or null when it can. */
  blockingReason(): string | null {
    const s = this.support.value;
    if (!s.checked) return 'Checking device support…';
    if (!s.secureContext)
      return 'Immersive mode needs a secure (https) page. Open SpatialDesk over https or on localhost.';
    if (!s.webgl) return 'This browser cannot render 3D content (WebGL is unavailable).';
    if (!s.xrApi)
      return 'This browser does not expose WebXR. Open SpatialDesk in the Meta Quest Browser to go immersive.';
    if (!s.immersiveAr && !s.immersiveVr)
      return 'No immersive session type is supported on this device.';
    return null;
  }

  async ensureWorld(): Promise<WorldHandle> {
    if (this.handle) return this.handle;
    if (this.loading) return this.loading;
    const container = this.deps.container();
    if (!container) throw new Error('Scene container is missing from the page.');
    this.phase.value = 'loading';
    this.error.value = null;
    container.hidden = false;
    const bridge: XrBridge = {
      store: this.deps.store,
      speech: this.deps.speech,
      immersive: this.immersive,
      onExitRequested: () => this.exitPreview(),
    };
    this.loading = import('./world')
      .then((mod) => mod.createWorkspaceWorld(container, bridge))
      .then((handle) => {
        this.handle = handle;
        this.unsubscribeVisibility = handle.world.visibilityState.subscribe((state) => {
          const visible = state === 'visible' || state === 'visible-blurred' || state === 'hidden';
          this.immersive.value = visible;
          if (visible) {
            this.phase.value = 'immersive';
          } else if (this.phase.peek() === 'immersive') {
            // Session ended (user pressed the system button or our Exit).
            this.phase.value = 'preview';
          }
        });
        this.phase.value = 'preview';
        return handle;
      })
      .catch((error: unknown) => {
        container.hidden = true;
        this.phase.value = 'error';
        this.error.value = `The 3D workspace could not start: ${error instanceof Error ? error.message : String(error)}`;
        throw error;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** Show the workspace as a non-immersive 3D scene inside the page. */
  async enterPreview(): Promise<void> {
    try {
      await this.ensureWorld();
      const container = this.deps.container();
      if (container) container.hidden = false;
      if (this.phase.peek() !== 'immersive') this.phase.value = 'preview';
    } catch {
      /* phase and error already set */
    }
  }

  /** Hide the preview and release the world so a later visit starts clean. */
  exitPreview(): void {
    if (this.handle?.world.session) {
      this.handle.world.exitXR();
    }
    this.dispose();
  }

  /** Request an immersive session. Must be called from a user gesture. */
  async enterImmersive(preferred?: XrMode): Promise<boolean> {
    const blocked = this.blockingReason();
    if (blocked) {
      this.error.value = blocked;
      this.phase.value = this.handle ? 'preview' : 'error';
      return false;
    }
    let handle: WorldHandle;
    try {
      handle = await this.ensureWorld();
    } catch {
      return false;
    }
    const s = this.support.value;
    const mode: XrMode =
      preferred && (preferred === 'immersive-ar' ? s.immersiveAr : s.immersiveVr)
        ? preferred
        : s.immersiveAr
          ? 'immersive-ar'
          : 'immersive-vr';
    this.mode.value = mode;
    this.phase.value = 'requesting';
    this.error.value = null;
    const { world } = handle;
    if (world.session) {
      this.phase.value = 'immersive';
      return true;
    }
    world.launchXR({ sessionMode: mode as never });
    // launchXR logs failures instead of throwing; wait for the request to settle
    // and inspect the outcome so the UI never claims a session that does not exist.
    const settled = await waitFor(() => !world.sessionRequestPending, 20_000);
    if (!settled) {
      this.phase.value = 'preview';
      this.error.value = 'The headset did not answer the session request in time.';
      return false;
    }
    if (world.session) {
      this.sessionsStarted.value += 1;
      this.phase.value = 'immersive';
      return true;
    }
    this.phase.value = 'preview';
    this.error.value =
      mode === 'immersive-ar'
        ? 'The immersive session was not started. The request may have been denied, or passthrough is unavailable. You can retry or try VR mode.'
        : 'The immersive session was not started. The request may have been denied by the browser or the user.';
    return false;
  }

  exitImmersive(): void {
    this.handle?.world.exitXR();
  }

  /** Destroy the world and free GPU resources. Safe to call repeatedly. */
  dispose(): void {
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    const handle = this.handle;
    this.handle = null;
    if (handle) {
      try {
        handle.world.destroy();
        handle.world.renderer.dispose();
        handle.world.renderer.domElement.remove();
      } catch (error) {
        console.warn('[SpatialDesk] world teardown reported an error', error);
      }
    }
    const container = this.deps.container();
    if (container) {
      container.hidden = true;
      container.replaceChildren();
    }
    this.immersive.value = false;
    this.mode.value = null;
    if (this.phase.peek() !== 'error') this.phase.value = 'idle';
  }
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}
