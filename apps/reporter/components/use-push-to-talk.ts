'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hold-to-speak on top of the browser's SpeechRecognition.
 *
 * Why the browser API and not a server transcriber: recognition starts the
 * instant the button is pressed, interim words appear while the user is still
 * talking, nothing leaves the machine except what the browser itself sends to
 * its speech service, and there is no audio upload path to secure. Chrome, Edge
 * and Safari support it; Firefox does not, so `supported` lets the UI say so
 * rather than show a button that does nothing.
 */

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null;
};

function getCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface PushToTalk {
  supported: boolean;
  listening: boolean;
  /** Words recognised so far in this press, interim included. */
  interim: string;
  error: string | null;
  start: () => void;
  /** Stops and resolves with the final transcript ('' if nothing was heard). */
  stop: () => Promise<string>;
  lang: string;
  setLang: (l: string) => void;
}

export const SPEECH_LANGS: Array<{ code: string; label: string }> = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'en-US', label: 'English (US)' },
];

export function usePushToTalk(): PushToTalk {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState('en-IN');

  const rec = useRef<Recognition | null>(null);
  const finalText = useRef('');
  const resolveStop = useRef<((t: string) => void) | null>(null);

  useEffect(() => { setSupported(getCtor() !== null); }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || rec.current) return;
    setError(null); setInterim(''); finalText.current = '';

    const r = new Ctor();
    r.lang = lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;

    r.onresult = (e: any) => {
      let fin = '', tmp = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript ?? '';
        if (res.isFinal) fin += t + ' '; else tmp += t;
      }
      finalText.current = fin.trim();
      setInterim((fin + tmp).trim());
    };
    r.onerror = (e: any) => {
      const code = e?.error as string | undefined;
      setError(
        code === 'not-allowed' || code === 'service-not-allowed' ? 'Microphone access was blocked. Allow it in the browser and try again.'
        : code === 'no-speech' ? null                       // released without saying anything — not an error
        : code === 'audio-capture' ? 'No microphone was found.'
        : code === 'network' ? 'Speech service unreachable.'
        : code ? `Speech recognition failed (${code}).` : 'Speech recognition failed.',
      );
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      // The final transcript arrives just before `end`; hand it to whoever
      // called stop(). Fall back to the interim words if nothing was finalised.
      const out = finalText.current || '';
      resolveStop.current?.(out);
      resolveStop.current = null;
    };

    try { r.start(); rec.current = r; setListening(true); }
    catch { setError('Could not start the microphone.'); }
  }, [lang]);

  const stop = useCallback((): Promise<string> => {
    const r = rec.current;
    if (!r) return Promise.resolve('');
    return new Promise<string>((resolve) => {
      resolveStop.current = (t) => resolve(t);
      try { r.stop(); } catch { resolve(finalText.current); }
      // Some engines never fire `end` after stop(); do not leave the caller hanging.
      setTimeout(() => { if (resolveStop.current) { resolveStop.current = null; resolve(finalText.current); } }, 2500);
    });
  }, []);

  useEffect(() => () => { try { rec.current?.abort(); } catch { /* unmounting */ } }, []);

  return { supported, listening, interim, error, start, stop, lang, setLang };
}
