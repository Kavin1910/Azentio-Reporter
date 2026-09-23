import { NextResponse } from 'next/server';
import { applyDatasetCustomisations, type ChartSpec, type Customisation } from '@azentio/core';
import { buildMessages, buildSchemaBlock, providerConfigFromEnv, runAgent } from '@azentio/llm';
import { getServerSupabase } from '@/lib/supabase/server';
import { getAllRows, getColumns, getCustomisations, getDataset } from '@/lib/data';
import { isUuid, rateLimit, MAX_CHAT_MESSAGE_CHARS } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HISTORY_LIMIT = 12;

/**
 * Per-dataset cache of the applied rows. Loading ~400 rows and re-applying
 * customisations cost ~1.5s of every chat turn; a chat turn is latency-critical.
 * Validated against a cheap version stamp (dataset updated_at + the newest
 * customisation decision) so an approval made a second ago is reflected.
 */
type Applied = ReturnType<typeof applyDatasetCustomisations>;
const APPLIED_CACHE = new Map<string, { stamp: string; applied: Applied; at: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function versionStamp(sb: Awaited<ReturnType<typeof getServerSupabase>>, datasetId: string): Promise<string> {
  // Two round-trips, in parallel: the dataset stamp and the most recent
  // customisation decision. Enough to notice a re-structure or an approval.
  const [{ data: ds }, { data: decided }] = await Promise.all([
    sb.from('datasets').select('updated_at, structured_at').eq('id', datasetId).maybeSingle(),
    sb.from('customisations').select('decided_at, created_at').eq('dataset_id', datasetId).is('mapping_id', null)
      .order('decided_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ]);
  return `${ds?.updated_at}|${ds?.structured_at}|${decided?.created_at}|${decided?.decided_at}`;
}

export async function POST(request: Request) {
  const sb = await getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body: { datasetId?: string; sessionId?: string | null; message?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid body.' }, { status: 400 }); }

  const message = body.message?.trim();
  if (!message || !body.datasetId) return NextResponse.json({ error: 'datasetId and message are required.' }, { status: 400 });
  if (!isUuid(body.datasetId) || (body.sessionId && !isUuid(body.sessionId))) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  if (message.length > MAX_CHAT_MESSAGE_CHARS) return NextResponse.json({ error: `Message is too long (max ${MAX_CHAT_MESSAGE_CHARS} characters).` }, { status: 413 });

  // Per-user: 30 questions a minute is generous for a person and a wall for a loop.
  const rl = rateLimit(`chat:${user.id}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: `Too many questions — try again in ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });

  // RLS: a dataset the caller does not own simply does not come back.
  const dataset = await getDataset(sb, body.datasetId);
  if (!dataset) return NextResponse.json({ error: 'Dataset not found.' }, { status: 404 });
  if (dataset.status !== 'structured') {
    return NextResponse.json({ error: 'Structure the dataset first — the assistant answers from the structured data.' }, { status: 409 });
  }

  let config;
  try { config = providerConfigFromEnv(); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : 'Assistant not configured.' }, { status: 503 }); }

  // Session: reuse the given one (verified through RLS) or start one.
  let sessionId = body.sessionId ?? null;
  if (sessionId) {
    const { data } = await sb.from('chat_sessions').select('id').eq('id', sessionId).eq('dataset_id', dataset.id).maybeSingle();
    if (!data) sessionId = null;
  }
  if (!sessionId) {
    const { data, error } = await sb.from('chat_sessions').insert({ dataset_id: dataset.id }).select('id').single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not start session.' }, { status: 500 });
    sessionId = data.id;
  }

  // The chat sees exactly what the report sees: approved customisations applied.
  const [stamp, historyResult] = await Promise.all([
    versionStamp(sb, dataset.id),
    sb.from('chat_messages').select('role, content').eq('session_id', sessionId)
      .in('role', ['user', 'assistant']).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
  ]);
  const cached = APPLIED_CACHE.get(dataset.id);
  let applied: Applied;
  if (cached && cached.stamp === stamp && Date.now() - cached.at < CACHE_TTL_MS) {
    applied = cached.applied;
  } else {
    const [columns, rows, customisations] = await Promise.all([
      getColumns(sb, dataset.id), getAllRows(sb, dataset.id), getCustomisations(sb, dataset.id, null),
    ]);
    applied = applyDatasetCustomisations(columns, rows, customisations as Customisation[]);
    APPLIED_CACHE.set(dataset.id, { stamp, applied, at: Date.now() });
  }
  const ctx = { datasetName: dataset.name, columns: applied.columns, rows: applied.rows };

  const history = (historyResult.data ?? []).reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const userInsert = sb.from('chat_messages').insert({ session_id: sessionId, role: 'user', content: message });

  const messages = buildMessages(buildSchemaBlock(dataset.name, applied.columns, applied.rows.length), [
    ...history, { role: 'user', content: message },
  ]);

  const encoder = new TextEncoder();
  const finalSessionId = sessionId;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'));
      send({ t: 'session', id: finalSessionId });

      let answer = '';
      let chart: ChartSpec | null = null;
      let failed = false;

      try {
        for await (const ev of runAgent(config, messages, ctx, request.signal)) {
          if (ev.type === 'text') { answer += ev.delta; send({ t: 'text', d: ev.delta }); }
          else if (ev.type === 'retract') { answer = ''; send({ t: 'retract' }); }
          else if (ev.type === 'tool_start') send({ t: 'tool', names: ev.names });
          else if (ev.type === 'chart') { chart = ev.chart; send({ t: 'chart', chart: ev.chart }); }
          else if (ev.type === 'error') { failed = true; send({ t: 'error', message: ev.message }); }
          else if (ev.type === 'done') {
            send({ t: 'done', ttftMs: ev.ttftMs, totalMs: ev.totalMs, cacheReadTokens: ev.usage.cacheReadTokens, toolsUsed: ev.toolsUsed });
            await userInsert;
            if (!failed && (answer || chart)) {
              await sb.from('chat_messages').insert({
                session_id: finalSessionId, role: 'assistant', content: answer, chart,
                tool_calls: ev.toolsUsed.length ? ev.toolsUsed : null,
                ttft_ms: ev.ttftMs, latency_ms: ev.totalMs,
                input_tokens: ev.usage.inputTokens, output_tokens: ev.usage.outputTokens,
                cache_read_tokens: ev.usage.cacheReadTokens,
              } as any);
              await sb.from('chat_sessions').update({ last_message_at: new Date().toISOString() }).eq('id', finalSessionId);
            }
          }
        }
      } catch (err) {
        send({ t: 'error', message: err instanceof Error ? err.message : 'Assistant failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
