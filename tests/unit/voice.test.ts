import { describe, expect, it } from 'vitest';
import { findTaskByVoiceQuery, parseVoiceCommand } from '../../src/voice/commands';
import { SpeechError, UnavailableSpeechProvider, WebSpeechProvider, createSpeechProvider } from '../../src/voice/provider';

describe('parseVoiceCommand', () => {
  it('creates tasks', () => {
    expect(parseVoiceCommand('add a task to call the dentist')).toEqual({ kind: 'create_task', title: 'Call the dentist' });
    expect(parseVoiceCommand('Create task buy milk.')).toEqual({ kind: 'create_task', title: 'Buy milk' });
    expect(parseVoiceCommand('remind me to send the invoice')).toEqual({ kind: 'create_task', title: 'Send the invoice' });
    expect(parseVoiceCommand('new todo water plants')).toEqual({ kind: 'create_task', title: 'Water plants' });
  });
  it('creates notes', () => {
    expect(parseVoiceCommand('take a note the meeting moved to Tuesday')).toEqual({
      kind: 'create_note',
      title: 'The meeting moved to Tuesday',
      body: 'The meeting moved to Tuesday',
    });
    expect(parseVoiceCommand('note that the api key rotates monthly').kind).toBe('create_note');
  });
  it('completes tasks', () => {
    expect(parseVoiceCommand('complete call the dentist')).toEqual({ kind: 'complete_task', query: 'call the dentist' });
    expect(parseVoiceCommand('mark buy milk as done')).toEqual({ kind: 'complete_task', query: 'buy milk' });
    expect(parseVoiceCommand('mark as done the task buy milk')).toEqual({ kind: 'complete_task', query: 'buy milk' });
  });
  it('searches and navigates', () => {
    expect(parseVoiceCommand('search for webxr')).toEqual({ kind: 'search', query: 'webxr' });
    expect(parseVoiceCommand('show me hand tracking')).toEqual({ kind: 'search', query: 'hand tracking' });
    expect(parseVoiceCommand('go to notes')).toEqual({ kind: 'navigate', target: 'notes' });
    expect(parseVoiceCommand('open my projects')).toEqual({ kind: 'navigate', target: 'projects' });
    expect(parseVoiceCommand('Tasks')).toEqual({ kind: 'navigate', target: 'tasks' });
  });
  it('returns unknown for anything else', () => {
    expect(parseVoiceCommand('')).toEqual({ kind: 'unknown', transcript: '' });
    expect(parseVoiceCommand('hello there')).toEqual({ kind: 'unknown', transcript: 'hello there' });
  });
});

describe('findTaskByVoiceQuery', () => {
  const tasks = [
    { id: '1', title: 'Call the dentist', status: 'todo' },
    { id: '2', title: 'Call mum', status: 'todo' },
    { id: '3', title: 'Buy milk', status: 'done' },
  ];
  it('matches exact and partial titles among open tasks', () => {
    expect(findTaskByVoiceQuery(tasks, 'call the dentist').match?.id).toBe('1');
    expect(findTaskByVoiceQuery(tasks, 'dentist').match?.id).toBe('1');
    expect(findTaskByVoiceQuery(tasks, 'buy milk').match).toBeNull();
  });
  it('reports ambiguity instead of guessing', () => {
    const r = findTaskByVoiceQuery(tasks, 'call');
    expect(r.match).toBeNull();
    expect(r.candidates).toHaveLength(2);
  });
});

describe('speech providers', () => {
  it('reports unsupported when the API is missing', async () => {
    const provider = createSpeechProvider({});
    expect(provider.available).toBe(false);
    expect(provider).toBeInstanceOf(UnavailableSpeechProvider);
    await expect(provider.listenOnce()).rejects.toBeInstanceOf(SpeechError);
  });

  it('resolves a final transcript from a fake recognizer', async () => {
    class FakeRecognition extends EventTarget {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      start() {
        queueMicrotask(() => {
          this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'add task ', confidence: 0.9 }], { isFinal: false })] });
          this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'add task buy milk', confidence: 0.9 }], { isFinal: true })] });
          this.onend?.();
        });
      }
      stop() {}
      abort() {
        this.onerror?.({ error: 'aborted' });
      }
    }
    const provider = new WebSpeechProvider({ SpeechRecognition: FakeRecognition });
    expect(provider.available).toBe(true);
    const interim: string[] = [];
    const result = await provider.listenOnce({ onInterim: (t) => interim.push(t) });
    expect(result).toEqual({ transcript: 'add task buy milk', confidence: 0.9, isFinal: true });
    expect(interim).toEqual(['add task ']);
  });

  it('maps permission errors and empty results', async () => {
    class Denied extends EventTarget {
      lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
      onresult = null; onend: (() => void) | null = null; onstart = null;
      onerror: ((e: unknown) => void) | null = null;
      start() { queueMicrotask(() => this.onerror?.({ error: 'not-allowed' })); }
      stop() {} abort() {}
    }
    await expect(new WebSpeechProvider({ SpeechRecognition: Denied }).listenOnce()).rejects.toMatchObject({ code: 'permission_denied' });
    class Silent extends EventTarget {
      lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
      onresult = null; onerror = null; onstart = null; onend: (() => void) | null = null;
      start() { queueMicrotask(() => this.onend?.()); }
      stop() {} abort() {}
    }
    await expect(new WebSpeechProvider({ SpeechRecognition: Silent }).listenOnce()).rejects.toMatchObject({ code: 'no_speech' });
  });
});
