/** Sends the same question three times and prints TTFT / total / cached tokens per turn. */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@azentio/core';
import { loadEnv, requireEnv } from './env';

const env = requireEnv(loadEnv(), ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
const APP = process.env.APP_URL ?? 'http://localhost:3000';

async function main() {
  const sb = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: auth } = await sb.auth.signInWithPassword({ email: 'demo@azentio.test', password: 'Password123!' });
  const { data: ds } = await sb.from('datasets').select('id').order('created_at', { ascending: false }).limit(1).single();
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0];
  const s = auth!.session!;
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, token_type: 'bearer', user: auth!.user })).toString('base64url')}`;

  const questions = [
    'How many loans were disbursed in March 2025?',
    'What is the total sanctioned amount?',
    'Which branch has the highest disbursed amount?',
    'Show a bar chart of disbursed amount by product',
  ];
  let sessionId: string | null = null;
  for (const q of questions) {
    const t0 = Date.now();
    const r: Response = await fetch(`${APP}/api/chat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ datasetId: ds!.id, sessionId, message: q }) });
    let firstByte: number | null = null;
    const text: string = await r.text();
    const evs: any[] = text.split('\n').filter(Boolean).map((l: string) => JSON.parse(l));
    sessionId = evs.find((e: any) => e.t === 'session')?.id ?? sessionId;
    const done = evs.find((e: any) => e.t === 'done');
    let answer = '';
    for (const e of evs) { if (e.t === 'text') answer += e.d; else if (e.t === 'retract') answer = ''; }
    const flags = [/\*\*/.test(answer) ? 'HAS **' : null, /^\s*(let me|i'll|i will)/i.test(answer) ? 'NARRATES' : null].filter(Boolean).join(' ');
    console.log(`\nQ: ${q}${flags ? `   [${flags}]` : ''}\n   ttft ${done?.ttftMs}ms · total ${done?.totalMs}ms · wall ${Date.now() - t0}ms · cached ${done?.cacheReadTokens} · tools ${done?.toolsUsed?.join(',') || '-'}\n   A: ${answer.slice(0, 160)}`);
    void firstByte;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
