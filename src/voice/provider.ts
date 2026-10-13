/**
 * Speech recognition boundary. The app only talks to `SpeechProvider`, so the
 * Web Speech API can be swapped for another engine without touching the UI.
 *
 * Privacy note: the browser's Web Speech implementation may send audio to the
 * browser vendor's servers for recognition. The UI states this before the
 * microphone is used, and nothing is recorded or stored by SpatialDesk itself.
 */
export type VoiceState = 'idle' | 'listening' | 'processing' | 'error';

export interface SpeechResult {
  transcript: string;
  confidence: number | null;
  isFinal: boolean;
}

export type SpeechErrorCode =
  | 'unsupported'
  | 'permission_denied'
  | 'no_speech'
  | 'audio_capture'
  | 'network'
  | 'aborted'
  | 'insecure_context'
  | 'unknown';

export class SpeechError extends Error {
  constructor(
    readonly code: SpeechErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SpeechError';
  }
}

export interface SpeechProvider {
  readonly name: string;
  readonly available: boolean;
  /** Why the provider is unavailable, for the UI. */
  readonly unavailableReason: string | null;
  /**
   * Listen for one utterance. Resolves with the final transcript, rejects with
   * a SpeechError. Calling `abort` rejects with code 'aborted'.
   */
  listenOnce(options: { lang?: string; signal?: AbortSignal; onInterim?: (text: string) => void }): Promise<SpeechResult>;
}

/* ------------------------- Web Speech API types ------------------------- */

interface WebSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
}
interface WebSpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}
interface WebSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type WebSpeechRecognitionCtor = new () => WebSpeechRecognition;

export function getSpeechRecognitionCtor(win: unknown = globalThis): WebSpeechRecognitionCtor | null {
  if (typeof win !== 'object' || win === null) return null;
  const w = win as Record<string, unknown>;
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as WebSpeechRecognitionCtor | undefined;
  return typeof ctor === 'function' ? ctor : null;
}

export const SPEECH_ERROR_MESSAGES: Record<SpeechErrorCode, string> = {
  unsupported: 'Speech recognition is not available in this browser.',
  permission_denied: 'Microphone access was denied. Allow the microphone to use voice input.',
  no_speech: 'No speech was detected. Try again and speak after the indicator appears.',
  audio_capture: 'No microphone could be used. Check your audio input device.',
  network: 'Speech recognition needs a network connection and it failed.',
  aborted: 'Listening was cancelled.',
  insecure_context: 'Voice input needs a secure (https) page.',
  unknown: 'Speech recognition failed for an unknown reason.',
};

function mapWebSpeechError(code: string): SpeechErrorCode {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission_denied';
    case 'no-speech':
      return 'no_speech';
    case 'audio-capture':
      return 'audio_capture';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

export class WebSpeechProvider implements SpeechProvider {
  readonly name = 'Web Speech API';
  readonly available: boolean;
  readonly unavailableReason: string | null;
  private readonly ctor: WebSpeechRecognitionCtor | null;

  constructor(win: unknown = globalThis) {
    this.ctor = getSpeechRecognitionCtor(win);
    const secure = typeof window === 'undefined' ? true : window.isSecureContext !== false;
    if (this.ctor === null) {
      this.available = false;
      this.unavailableReason = SPEECH_ERROR_MESSAGES.unsupported;
    } else if (!secure) {
      this.available = false;
      this.unavailableReason = SPEECH_ERROR_MESSAGES.insecure_context;
    } else {
      this.available = true;
      this.unavailableReason = null;
    }
  }

  listenOnce(options: { lang?: string; signal?: AbortSignal; onInterim?: (text: string) => void } = {}): Promise<SpeechResult> {
    const Ctor = this.ctor;
    if (!this.available || Ctor === null) {
      return Promise.reject(new SpeechError('unsupported', this.unavailableReason ?? SPEECH_ERROR_MESSAGES.unsupported));
    }
    return new Promise<SpeechResult>((resolve, reject) => {
      const rec = new Ctor();
      rec.lang = options.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let settled = false;
      let finalText = '';
      let confidence: number | null = null;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () => {
        rec.abort();
        finish(() => reject(new SpeechError('aborted', SPEECH_ERROR_MESSAGES.aborted)));
      };
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      options.signal?.addEventListener('abort', onAbort, { once: true });

      rec.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) continue;
          const alt = result[0];
          if (!alt) continue;
          if (result.isFinal) {
            finalText += alt.transcript;
            confidence = typeof alt.confidence === 'number' ? alt.confidence : null;
          } else {
            interim += alt.transcript;
          }
        }
        if (interim && options.onInterim) options.onInterim(interim);
      };
      rec.onerror = (event) => {
        const code = mapWebSpeechError(event.error);
        finish(() => reject(new SpeechError(code, SPEECH_ERROR_MESSAGES[code])));
      };
      rec.onend = () => {
        const transcript = finalText.trim();
        if (transcript === '') {
          finish(() => reject(new SpeechError('no_speech', SPEECH_ERROR_MESSAGES.no_speech)));
          return;
        }
        finish(() => resolve({ transcript, confidence, isFinal: true }));
      };
      try {
        rec.start();
      } catch (error) {
        finish(() => reject(new SpeechError('unknown', (error as Error).message || SPEECH_ERROR_MESSAGES.unknown)));
      }
    });
  }
}

/** Provider used when nothing on the platform can recognise speech. */
export class UnavailableSpeechProvider implements SpeechProvider {
  readonly name = 'none';
  readonly available = false;
  constructor(readonly unavailableReason: string = SPEECH_ERROR_MESSAGES.unsupported) {}
  listenOnce(): Promise<SpeechResult> {
    return Promise.reject(new SpeechError('unsupported', this.unavailableReason));
  }
}

export function createSpeechProvider(win: unknown = globalThis): SpeechProvider {
  const provider = new WebSpeechProvider(win);
  return provider.available ? provider : new UnavailableSpeechProvider(provider.unavailableReason ?? undefined);
}
