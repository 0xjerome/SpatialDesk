import { useEffect } from 'preact/hooks';
import { useApp } from '../context';
import { Banner, Button, HeadsetIcon } from '../components/ui';

export function SpatialView() {
  const { xr, store, router } = useApp();
  const support = xr.support.value;
  const phase = xr.phase.value;
  const error = xr.error.value;
  const blocked = xr.blockingReason();

  useEffect(() => {
    void xr.detect();
  }, [xr]);
  // Leaving the route tears the preview down so nothing keeps rendering behind the app.
  useEffect(() => () => xr.exitPreview(), [xr]);

  const open = store.openTasks.value.length;
  const previewActive = phase === 'preview' || phase === 'immersive' || phase === 'requesting';

  return (
    <>
      <div class="topbar">
        <div class="topbar-title">
          <h1>Spatial workspace</h1>
          <span class="muted small">
            Your tasks, notes, projects and research as panels you can pinch, press and move in
            mixed reality.
          </span>
        </div>
      </div>
      <div class="xr-hero">
        <section class="card stack">
          <h2 class="row">
            <HeadsetIcon /> Enter the workspace
          </h2>
          <p class="small muted">
            On a Meta Quest, open this page in the Quest Browser and press Enter immersive. Panels
            appear in front of you: point and pinch (or use a controller trigger) to select, pinch
            the bar above a panel to move it, and use the Voice button to add tasks by speaking.
            Your {open} open tasks are already there.
          </p>
          {blocked && support.checked ? (
            <Banner tone="warning" testId="xr-blocked">
              {blocked}
            </Banner>
          ) : null}
          {error ? (
            <Banner tone="error" testId="xr-error">
              {error}
            </Banner>
          ) : null}
          {phase === 'immersive' ? (
            <Banner tone="success" testId="xr-active">
              Immersive session active ({xr.mode.value}).
            </Banner>
          ) : null}
          <div class="row">
            <Button
              variant="primary"
              icon={<HeadsetIcon />}
              busy={phase === 'loading' || phase === 'requesting'}
              disabled={Boolean(blocked) || phase === 'immersive'}
              onClick={() => void xr.enterImmersive()}
              data-testid="xr-enter"
            >
              {phase === 'requesting'
                ? 'Starting session…'
                : phase === 'loading'
                  ? 'Loading workspace…'
                  : support.immersiveAr
                    ? 'Enter mixed reality'
                    : 'Enter immersive'}
            </Button>
            {support.immersiveAr && support.immersiveVr ? (
              <Button
                disabled={Boolean(blocked) || phase === 'immersive' || phase === 'requesting'}
                onClick={() => void xr.enterImmersive('immersive-vr')}
                data-testid="xr-enter-vr"
              >
                Enter VR instead
              </Button>
            ) : null}
            {!previewActive ? (
              <Button
                busy={phase === 'loading'}
                disabled={!support.webgl && support.checked}
                onClick={() => void xr.enterPreview()}
                data-testid="xr-preview"
              >
                Preview in browser
              </Button>
            ) : (
              <Button onClick={() => xr.exitPreview()} data-testid="xr-exit-preview">
                Close preview
              </Button>
            )}
          </div>
          <p class="small faint">
            The browser preview renders the same panels with mouse input so you can check your
            workspace on a desktop. It is not a substitute for testing on a headset.
          </p>
        </section>
        <section class="card stack">
          <h2>Device check</h2>
          <div class="status-list" data-testid="xr-status">
            <Row
              label="Secure context (https)"
              value={support.checked ? (support.secureContext ? 'Yes' : 'No') : '…'}
            />
            <Row
              label="WebGL rendering"
              value={support.checked ? (support.webgl ? 'Available' : 'Unavailable') : '…'}
            />
            <Row
              label="WebXR API"
              value={
                support.checked
                  ? support.xrApi
                    ? support.emulated
                      ? 'Emulated (development)'
                      : 'Available'
                    : 'Not available'
                  : '…'
              }
            />
            <Row
              label="Mixed reality (immersive-ar)"
              value={support.checked ? (support.immersiveAr ? 'Supported' : 'Not supported') : '…'}
            />
            <Row
              label="Virtual reality (immersive-vr)"
              value={support.checked ? (support.immersiveVr ? 'Supported' : 'Not supported') : '…'}
            />
            <Row
              label="Browser"
              value={
                support.emulated
                  ? 'Desktop browser (Quest emulated)'
                  : support.questBrowser
                    ? 'Meta Quest Browser'
                    : 'Other'
              }
            />
            <Row label="Sessions this visit" value={String(xr.sessionsStarted.value)} />
          </div>
          <p class="small muted">
            Hand tracking is requested as an optional feature; controllers are always supported.
            Enable hand tracking in the Quest settings to use pinch gestures.
          </p>
          <Button variant="ghost" onClick={() => void xr.detect()}>
            Re-check
          </Button>
          <Button variant="ghost" onClick={() => router.navigate('home')}>
            Back to workspace
          </Button>
        </section>
      </div>
      {previewActive ? (
        <div class="xr-overlay" data-testid="xr-overlay">
          <Button onClick={() => xr.exitPreview()} data-testid="xr-overlay-back">
            Back to app
          </Button>
          {phase === 'preview' && !blocked ? (
            <Button
              variant="primary"
              onClick={() => void xr.enterImmersive()}
              data-testid="xr-overlay-enter"
            >
              Enter immersive
            </Button>
          ) : null}
          {phase === 'requesting' ? (
            <Button variant="primary" busy disabled>
              Starting session…
            </Button>
          ) : null}
          {phase === 'immersive' ? (
            <Button onClick={() => xr.exitImmersive()} data-testid="xr-overlay-exit">
              Exit immersive
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div class="status-row">
      <span class="muted">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
