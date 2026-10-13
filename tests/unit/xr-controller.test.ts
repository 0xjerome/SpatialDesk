import { afterEach, describe, expect, it, vi } from 'vitest';
import { XrController } from '../../src/xr/controller';
import { MemoryStorageAdapter } from '../../src/domain/persistence';
import { WorkspaceStore } from '../../src/domain/store';
import { UnavailableSpeechProvider } from '../../src/voice/provider';

// jsdom reports no secure context and has no WebGL; stub both so detection reaches the WebXR checks.
Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
HTMLCanvasElement.prototype.getContext =
  (() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

function makeController() {
  const container = document.createElement('div');
  container.id = 'scene-container';
  container.hidden = true;
  document.body.appendChild(container);
  const store = new WorkspaceStore({ storage: new MemoryStorageAdapter(), saveDelayMs: 0 });
  return {
    controller: new XrController({
      store,
      speech: new UnavailableSpeechProvider(),
      container: () => container,
    }),
    container,
  };
}

function setXr(value: unknown) {
  Object.defineProperty(navigator, 'xr', { value, configurable: true });
}

describe('XrController.detect', () => {
  afterEach(() => {
    setXr(undefined);
    vi.restoreAllMocks();
  });

  it('reports a missing WebXR API as a blocking reason', async () => {
    const { controller } = makeController();
    setXr(undefined);
    const support = await controller.detect();
    expect(support.xrApi).toBe(false);
    expect(controller.blockingReason()).toMatch(/does not expose WebXR/);
  });

  it('prefers AR when both modes are supported and surfaces emulation', async () => {
    const { controller } = makeController();
    setXr({
      isSessionSupported: async (mode: string) =>
        mode === 'immersive-ar' || mode === 'immersive-vr',
    });
    (window as unknown as { IWER_DEVICE?: object }).IWER_DEVICE = {};
    const support = await controller.detect();
    delete (window as unknown as { IWER_DEVICE?: object }).IWER_DEVICE;
    expect(support.immersiveAr).toBe(true);
    expect(support.immersiveVr).toBe(true);
    expect(support.emulated).toBe(true);
  });

  it('treats a throwing isSessionSupported as unsupported', async () => {
    const { controller } = makeController();
    setXr({
      isSessionSupported: async () => {
        throw new Error('nope');
      },
    });
    const support = await controller.detect();
    expect(support.immersiveAr).toBe(false);
    expect(support.immersiveVr).toBe(false);
    expect(controller.blockingReason()).toMatch(/No immersive session type/);
  });

  it('reports an insecure context before anything else', async () => {
    const { controller } = makeController();
    const original = window.isSecureContext;
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    setXr({ isSessionSupported: async () => true });
    await controller.detect();
    expect(controller.blockingReason()).toMatch(/secure \(https\)/);
    Object.defineProperty(window, 'isSecureContext', { value: original, configurable: true });
  });

  it('refuses to enter immersive mode when blocked and never loads the world', async () => {
    const { controller, container } = makeController();
    setXr(undefined);
    await controller.detect();
    const ok = await controller.enterImmersive();
    expect(ok).toBe(false);
    expect(controller.error.value).toMatch(/WebXR/);
    expect(controller.world).toBeNull();
    expect(container.hidden).toBe(true);
    expect(controller.phase.value).toBe('error');
  });

  it('dispose is idempotent and resets the phase', () => {
    const { controller } = makeController();
    controller.dispose();
    controller.dispose();
    expect(controller.phase.value).toBe('idle');
    expect(controller.immersive.value).toBe(false);
  });
});
