'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChartSpec } from '@azentio/core';
import { Chart } from './chart';
import { Tip } from './tip';
import { ArrowLeft, History, Message, Mic, MicOff, Plus, Send, Trash, X } from './icons';
import { usePushToTalk, SPEECH_LANGS } from './use-push-to-talk';
import { RichText } from './rich-text';

interface Msg { id: string; role: 'user' | 'assistant'; content: string; chart?: ChartSpec | null }
interface Metrics { ttftMs: number | null; totalMs: number; cacheReadTokens: number; toolsUsed: string[] }
interface SessionSummary { id: string; created_at: string; last_message_at: string; preview: string; message_count: number }

const SUGGESTIONS = [
  'What is the total sanctioned amount by branch?',
  'Show a pie chart of loans by product',
  'Which accounts have DPD over 90?',
  'Bar chart of disbursement by month',
];

const TOOL_COPY: Record<string, string> = {
  describe_dataset: 'Reading the schema…',
  query_dataset: 'Running the numbers…',
  find_rows: 'Finding matching rows…',
  make_chart: 'Drawing the chart…',
};

function relative(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(iso));
}

/**
 * Floating assistant, scoped to the loaded dataset by construction.
 *
 * Conversations persist per dataset: opening the panel resumes the most recent
 * one, History lists the rest, New chat starts clean (a session row is created
 * on the first message, so abandoned empties never accumulate), and Delete
 * removes a conversation or all of them.
 */
export function ChatWidget({ datasetId, datasetName }: { datasetId: string; datasetName: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resumed = useRef<string | null>(null);

  // Push-to-talk. Hold → listen, release → send what was heard. While held the
  // interim transcript shows in the composer so the user can see it landing.
  const ptt = usePushToTalk();
  const typedBeforeHold = useRef('');
  const holdStart = useCallback((e: React.PointerEvent) => {
    if (streaming || !ptt.supported) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    typedBeforeHold.current = input;
    ptt.start();
  }, [streaming, ptt, input]);
  const holdEnd = useCallback(async () => {
    if (!ptt.listening) return;
    const heard = (await ptt.stop()).trim();
    const prefix = typedBeforeHold.current.trim();
    const text = [prefix, heard].filter(Boolean).join(' ');
    if (heard) void send(text);           // spoke → send on release
    else setInput(prefix);                // nothing heard → leave what was typed
  }, [ptt]);  // eslint-disable-line react-hooks/exhaustive-deps

  const api = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(url, init);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status}).`);
    return body as T;
  }, []);

  const listSessions = useCallback(async () => {
    const { sessions } = await api<{ sessions: SessionSummary[] }>(`/api/chat/sessions?datasetId=${datasetId}`);
    setSessions(sessions);
    return sessions;
  }, [api, datasetId]);

  const loadSession = useCallback(async (id: string) => {
    setLoading(true); setError(null);
    try {
      const { messages } = await api<{ messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; chart: ChartSpec | null }> }>(`/api/chat/sessions/${id}`);
      setMessages(messages.map((m) => ({ id: m.id, role: m.role, content: m.content, chart: m.chart })));
      setSessionId(id); setMetrics(null); setView('chat');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load that conversation.'); }
    finally { setLoading(false); }
  }, [api]);

  const newChat = useCallback(() => {
    setMessages([]); setSessionId(null); setMetrics(null); setError(null); setView('chat');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await api(`/api/chat/sessions/${id}`, { method: 'DELETE' });
      if (id === sessionId) newChat();
      await listSessions();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.'); }
  }, [api, sessionId, newChat, listSessions]);

  const deleteAll = useCallback(async () => {
    if (!confirm(`Delete every conversation about “${datasetName}”?`)) return;
    try {
      await api(`/api/chat/sessions?datasetId=${datasetId}`, { method: 'DELETE' });
      newChat(); setSessions([]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.'); }
  }, [api, datasetId, datasetName, newChat]);

  // New dataset → new conversation context.
  useEffect(() => { setMessages([]); setSessionId(null); setSessions([]); setMetrics(null); setError(null); setView('chat'); resumed.current = null; }, [datasetId]);

  // First open for a dataset: resume its most recent conversation.
  useEffect(() => {
    if (!open || resumed.current === datasetId) return;
    resumed.current = datasetId;
    (async () => {
      try {
        const list = await listSessions();
        if (list[0] && !sessionId && messages.length === 0) await loadSession(list[0].id);
      } catch { /* history is a convenience; the chat still works without it */ }
    })();
  }, [open, datasetId, listSessions, loadSession, sessionId, messages.length]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, note, open, view]);
  useEffect(() => { if (open && view === 'chat') inputRef.current?.focus(); }, [open, view]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming) return;
    setError(null); setMetrics(null); setInput(''); setView('chat');
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', content: q }]);
    setStreaming(true);

    const id = crypto.randomUUID();
    let opened = false;
    const ensure = () => { if (!opened) { opened = true; setMessages((m) => [...m, { id, role: 'assistant', content: '' }]); } };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId, sessionId, message: q }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
        throw new Error(d.error ?? `Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === 'session') setSessionId(ev.id);
          else if (ev.t === 'text') { setNote(null); ensure(); setMessages((m) => m.map((x) => (x.id === id ? { ...x, content: x.content + ev.d } : x))); }
          else if (ev.t === 'retract') setMessages((m) => m.map((x) => (x.id === id ? { ...x, content: '' } : x)));
          else if (ev.t === 'tool') setNote(TOOL_COPY[ev.names?.[0]] ?? 'Looking that up…');
          else if (ev.t === 'chart') { setNote(null); ensure(); setMessages((m) => m.map((x) => (x.id === id ? { ...x, chart: ev.chart } : x))); }
          else if (ev.t === 'error') setError(ev.message);
          else if (ev.t === 'done') setMetrics({ ttftMs: ev.ttftMs, totalMs: ev.totalMs, cacheReadTokens: ev.cacheReadTokens ?? 0, toolsUsed: ev.toolsUsed ?? [] });
        }
      }
      listSessions().catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setStreaming(false); setNote(null); inputRef.current?.focus();
    }
  }

  const iconBtn = 'flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition hover:bg-[var(--color-canvas-sunken)] hover:text-[var(--color-ink)] disabled:opacity-40';

  return (
    <>
      {/* launcher — the FIXED wrapper must not be the Tip element: the tooltip's
          `[data-tip] { position: relative }` would otherwise win over `.fixed`. */}
      <div className="fixed bottom-6 right-6 z-50 no-print">
        <Tip text={open ? 'Close the assistant' : `Ask questions about "${datasetName}" — answers come only from this data`}>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="assistant-panel"
            className="flex h-[52px] items-center gap-2 rounded-full bg-[var(--color-brand)] pl-4 pr-5 text-[13px] font-semibold text-white shadow-[var(--shadow-lg)] transition hover:bg-[var(--color-brand-hover)]"
          >
            {open ? <X size={17} /> : <Message size={17} />}
            <span>{open ? 'Close' : 'Ask the data'}</span>
          </button>
        </Tip>
      </div>

      {open && (
        <section
          id="assistant-panel"
          role="dialog"
          aria-label="Data assistant"
          className="surface fixed bottom-[88px] right-6 z-50 flex h-[min(620px,calc(100vh-120px))] w-[min(400px,calc(100vw-48px))] flex-col overflow-hidden shadow-[var(--shadow-lg)] rise no-print"
        >
          {/* ------------------------------------------------------ header */}
          <header className="flex items-center gap-2 border-b border-[var(--color-line-soft)] bg-[var(--color-paper-tint)] px-3 py-2.5">
            {view === 'history' ? (
              <>
                <Tip text="Back to the conversation"><button className={iconBtn} onClick={() => setView('chat')} aria-label="Back"><ArrowLeft size={16} /></button></Tip>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-tight">History</p>
                  <p className="truncate text-[11.5px] text-[var(--color-ink-muted)]">{sessions.length} conversation{sessions.length === 1 ? '' : 's'} about “{datasetName}”</p>
                </div>
                {sessions.length > 0 && (
                  <Tip text="Delete every conversation for this dataset">
                    <button className={`${iconBtn} hover:text-[var(--color-danger-text)]`} onClick={deleteAll} aria-label="Delete all conversations"><Trash size={15} /></button>
                  </Tip>
                )}
              </>
            ) : (
              <>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><Message size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-tight">Data assistant</p>
                  <p className="truncate text-[11.5px] text-[var(--color-ink-muted)]">Answers only from “{datasetName}”</p>
                </div>
                <Tip text="Previous conversations"><button className={iconBtn} onClick={() => { setView('history'); listSessions().catch(() => {}); }} aria-label="History"><History size={16} /></button></Tip>
                <Tip text="Start a new conversation"><button className={iconBtn} onClick={newChat} disabled={streaming || messages.length === 0} aria-label="New chat"><Plus size={16} /></button></Tip>
                <Tip text="Delete this conversation">
                  <button className={`${iconBtn} hover:text-[var(--color-danger-text)]`} onClick={() => sessionId && deleteSession(sessionId)} disabled={!sessionId || streaming} aria-label="Delete conversation"><Trash size={15} /></button>
                </Tip>
              </>
            )}
          </header>

          {/* ------------------------------------------------------- history */}
          {view === 'history' ? (
            <div className="scroll-thin flex-1 overflow-y-auto p-2">
              {sessions.length === 0 ? (
                <p className="px-3 py-10 text-center text-[13px] text-[var(--color-ink-muted)]">No previous conversations.</p>
              ) : (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {sessions.map((s) => {
                    const active = s.id === sessionId;
                    return (
                      <li key={s.id} className="group flex items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2.5 transition"
                          style={{ borderColor: active ? 'var(--color-brand)' : 'var(--color-line-soft)', background: active ? 'var(--color-brand-soft)' : 'transparent' }}>
                        <button className="min-w-0 flex-1 text-left" onClick={() => loadSession(s.id)} aria-label={`Open conversation: ${s.preview}`}>
                          <span className="block truncate text-[12.5px] font-medium text-[var(--color-ink)]">{s.preview || 'Conversation'}</span>
                          <span className="tabular mt-0.5 block text-[11px] text-[var(--color-ink-faint)]">{s.message_count} message{s.message_count === 1 ? '' : 's'} · {relative(s.last_message_at)}{active ? ' · current' : ''}</span>
                        </button>
                        <Tip text="Delete this conversation">
                          <button className={`${iconBtn} h-7 w-7 opacity-60 group-hover:opacity-100 hover:text-[var(--color-danger-text)]`} onClick={() => deleteSession(s.id)} aria-label="Delete"><Trash size={14} /></button>
                        </Tip>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-2 px-1">
                <button className="btn btn-ghost w-full" onClick={newChat}><Plus size={14} /> New conversation</button>
              </div>
            </div>
          ) : (
            <>
              {/* ---------------------------------------------------- messages */}
              <div className="scroll-thin flex-1 overflow-y-auto px-4 py-4">
                {loading ? (
                  <p className="py-10 text-center text-[12.5px] text-[var(--color-ink-muted)]"><span className="typing"><i /><i /><i /></span></p>
                ) : messages.length === 0 ? (
                  <div>
                    <p className="text-[13px] leading-relaxed text-[var(--color-ink-soft)]">Ask about totals, breakdowns or specific accounts. I can draw bar and pie charts from the data.</p>
                    <div className="mt-3 grid gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} onClick={() => send(s)} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-left text-[12.5px] leading-snug text-[var(--color-ink-soft)] transition hover:border-[var(--color-sage-500)] hover:bg-[var(--color-paper-tint)]">{s}</button>
                      ))}
                    </div>
                    {sessions.length > 0 && (
                      <button className="mt-4 flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-brand)] hover:underline" onClick={() => setView('history')}>
                        <History size={13} /> {sessions.length} previous conversation{sessions.length === 1 ? '' : 's'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {messages.filter((m) => m.content.trim() || m.chart).map((m) => (
                      <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[88%] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === 'user' ? 'rounded-br-[4px] bg-[var(--color-brand)] text-white' : 'rounded-bl-[4px] border border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-ink-soft)]'}`}>
                          {m.chart && <div className="mb-2 -mx-1"><Chart spec={m.chart} compact /></div>}
                          <RichText text={m.content} />
                        </div>
                      </div>
                    ))}
                    {streaming && (note || messages[messages.length - 1]?.role === 'user') && (
                      <div className="flex justify-start">
                        <div className="rounded-[14px] rounded-bl-[4px] border border-[var(--color-line)] bg-[var(--color-paper)] px-3.5 py-2.5 text-[12.5px] text-[var(--color-ink-muted)]">
                          {note ?? <span className="typing"><i /><i /><i /></span>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {error && <p role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-danger-soft)] px-3 py-2 text-[12.5px] text-[var(--color-danger-text)]">{error}</p>}
                <div ref={endRef} />
              </div>

              {/* ---------------------------------------------------- composer */}
              <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-[var(--color-line-soft)] bg-[var(--color-paper)] px-3 py-3">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef} rows={1}
                    className="field max-h-32 min-h-[40px] flex-1 resize-none py-2.5 text-[13px]"
                    placeholder={ptt.listening ? 'Listening…' : 'Ask about this dataset…'}
                    value={ptt.listening ? [typedBeforeHold.current.trim(), ptt.interim].filter(Boolean).join(' ') : input}
                    disabled={streaming || ptt.listening}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                    aria-label="Message"
                  />
                  <Tip text={
                    !ptt.supported ? 'Voice input needs Chrome, Edge or Safari'
                    : ptt.listening ? 'Listening — release to send'
                    : `Hold to speak (${SPEECH_LANGS.find((l) => l.code === ptt.lang)?.label ?? ptt.lang}). Release to send.`
                  }>
                    <button
                      type="button"
                      aria-label={ptt.listening ? 'Listening, release to send' : 'Hold to speak'}
                      aria-pressed={ptt.listening}
                      disabled={streaming || !ptt.supported}
                      className={`ptt-btn btn btn-ghost h-[40px] w-[40px] p-0 ${ptt.listening ? 'ptt-live' : ''}`}
                      onPointerDown={holdStart}
                      onPointerUp={holdEnd}
                      onPointerCancel={holdEnd}
                      onPointerLeave={(e) => { if (ptt.listening && (e.buttons & 1) === 0) void holdEnd(); }}
                      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !ptt.listening) { e.preventDefault(); typedBeforeHold.current = input; ptt.start(); } }}
                      onKeyUp={(e) => { if ((e.key === ' ' || e.key === 'Enter') && ptt.listening) { e.preventDefault(); void holdEnd(); } }}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      {ptt.supported ? <Mic size={16} /> : <MicOff size={16} />}
                    </button>
                  </Tip>
                  <Tip text="Send (Enter)">
                    <button type="submit" className="btn btn-primary h-[40px] w-[40px] p-0" disabled={streaming || !input.trim()} aria-label="Send"><Send size={15} /></button>
                  </Tip>
                </div>
                {ptt.error && <p role="alert" className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-danger-soft)] px-3 py-1.5 text-[12px] text-[var(--color-danger-text)]">{ptt.error}</p>}
                <div className="mt-1.5 flex items-center justify-between gap-3 px-0.5">
                  <span className="flex items-center gap-2 text-[10.5px] text-[var(--color-ink-faint)]">
                    Reflects approved customisations only.
                    {ptt.supported && (
                      <Tip text="Language for voice input">
                        <select
                          aria-label="Voice language"
                          className="cursor-pointer bg-transparent text-[10.5px] text-[var(--color-ink-muted)] outline-none hover:text-[var(--color-ink)]"
                          value={ptt.lang}
                          onChange={(e) => ptt.setLang(e.target.value)}
                        >
                          {SPEECH_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                        </select>
                      </Tip>
                    )}
                  </span>
                  {metrics && (
                    <Tip text="Time to first token · total · cached prompt tokens">
                      <span className="tabular text-[10.5px] text-[var(--color-ink-faint)]">
                        {metrics.ttftMs !== null && <>{metrics.ttftMs}ms · </>}{metrics.totalMs}ms{metrics.cacheReadTokens > 0 && <> · {metrics.cacheReadTokens} cached</>}
                      </span>
                    </Tip>
                  )}
                </div>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}
