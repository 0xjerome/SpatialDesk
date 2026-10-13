import { useEffect, useRef, useState } from 'preact/hooks';
import { findTaskByVoiceQuery, parseVoiceCommand, type VoiceCommand } from '../../voice/commands';
import { SpeechError } from '../../voice/provider';
import { useApp } from '../context';
import { Banner, Button, Dialog, MicIcon } from '../components/ui';

type Phase = 'idle' | 'listening' | 'review' | 'error';

/**
 * Voice capture flow: listen once, show the transcript, propose an action and
 * require an explicit confirmation before touching any data.
 */
export function VoiceDialog() {
  const { voiceOpen, speech, store, router, toaster } = useApp();
  const open = voiceOpen.value;
  const [phase, setPhase] = useState<Phase>('idle');
  const [interim, setInterim] = useState('');
  const [transcript, setTranscript] = useState('');
  const [command, setCommand] = useState<VoiceCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const close = () => {
    abortRef.current?.abort();
    voiceOpen.value = false;
  };

  const listen = async () => {
    setError(null);
    setInterim('');
    setTranscript('');
    setCommand(null);
    setPhase('listening');
    abortRef.current = new AbortController();
    try {
      const result = await speech.listenOnce({
        signal: abortRef.current.signal,
        onInterim: setInterim,
      });
      setTranscript(result.transcript);
      setCommand(parseVoiceCommand(result.transcript));
      setPhase('review');
    } catch (e) {
      if (e instanceof SpeechError && e.code === 'aborted') {
        setPhase('idle');
        return;
      }
      setError(e instanceof Error ? e.message : 'Speech recognition failed.');
      setPhase('error');
    }
  };

  useEffect(() => {
    if (open && speech.available) {
      void listen();
    } else if (!open) {
      setPhase('idle');
    }
  }, [open]);

  const confirm = () => {
    if (!command) return;
    switch (command.kind) {
      case 'create_task': {
        const r = store.createTask({ title: command.title });
        if (r.ok) toaster.show('success', `Task "${r.value.title}" created`);
        else toaster.show('error', Object.values(r.errors)[0] ?? 'Could not create task');
        break;
      }
      case 'create_note': {
        const r = store.createNote({ title: command.title, body: command.body });
        if (r.ok) {
          toaster.show('success', `Note "${r.value.title}" saved`);
          router.navigate('notes', r.value.id);
        }
        break;
      }
      case 'complete_task': {
        const { match } = findTaskByVoiceQuery(store.tasks.value, command.query);
        if (match) {
          const r = store.updateTask(match.id, { status: 'done' });
          if (r.ok) toaster.show('success', `Completed "${match.title}"`);
        }
        break;
      }
      case 'search':
        router.navigate('tasks', null, { q: command.query });
        break;
      case 'navigate':
        router.navigate(command.target);
        break;
      case 'unknown':
        break;
    }
    close();
  };

  const proposal = command ? describe(command, store.tasks.value) : null;

  return (
    <Dialog open={open} title="Voice command" onClose={close} testId="voice-dialog">
      {!speech.available ? (
        <Banner tone="warning">{speech.unavailableReason}</Banner>
      ) : (
        <>
          <p class="small muted">
            Try “add a task to call the dentist”, “note that the demo moved to Friday”, “complete
            buy milk” or “go to projects”. Audio is handled by your browser's speech service and is
            not stored by SpatialDesk.
          </p>
          {phase === 'listening' ? (
            <div class="voice-indicator" role="status" aria-live="polite">
              <span class="voice-pulse" aria-hidden="true" />
              <div class="grow">
                <strong>Listening…</strong>
                <div class="transcript muted">{interim || 'Speak now'}</div>
              </div>
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
                Stop
              </Button>
            </div>
          ) : null}
          {phase === 'error' ? <Banner tone="error">{error}</Banner> : null}
          {phase === 'review' && command ? (
            <div class="stack">
              <div class="transcript" data-testid="voice-transcript">
                “{transcript}”
              </div>
              {command.kind === 'unknown' ? (
                <Banner tone="info">
                  I did not recognise a command in that. Nothing was changed.
                </Banner>
              ) : proposal?.blocked ? (
                <Banner tone="warning">{proposal.text}</Banner>
              ) : (
                <Banner tone="success" testId="voice-proposal">
                  {proposal?.text}
                </Banner>
              )}
            </div>
          ) : null}
          <div class="row" style={{ justifyContent: 'flex-end' }}>
            {phase !== 'listening' ? (
              <Button icon={<MicIcon />} onClick={listen}>
                {phase === 'idle' ? 'Start listening' : 'Try again'}
              </Button>
            ) : null}
            {phase === 'review' && command && command.kind !== 'unknown' && !proposal?.blocked ? (
              <Button variant="primary" onClick={confirm} data-testid="voice-confirm">
                Confirm
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Dialog>
  );
}

function describe(
  command: VoiceCommand,
  tasks: readonly { id: string; title: string; status: string }[],
): { text: string; blocked: boolean } {
  switch (command.kind) {
    case 'create_task':
      return { text: `Create task “${command.title}”?`, blocked: false };
    case 'create_note':
      return { text: `Save a note titled “${command.title}”?`, blocked: false };
    case 'complete_task': {
      const { match, candidates } = findTaskByVoiceQuery(tasks, command.query);
      if (match) return { text: `Mark “${match.title}” as done?`, blocked: false };
      if (candidates.length > 1)
        return {
          text: `Several tasks match “${command.query}”: ${candidates.map((c) => c.title).join(', ')}. Say the full title.`,
          blocked: true,
        };
      return { text: `No open task matches “${command.query}”.`, blocked: true };
    }
    case 'search':
      return { text: `Search tasks for “${command.query}”?`, blocked: false };
    case 'navigate':
      return { text: `Open ${command.target}?`, blocked: false };
    default:
      return { text: '', blocked: true };
  }
}
