import { createClient } from '@supabase/supabase-js';
import type { Database } from '@azentio/core';
import { loadEnv, requireEnv } from './env';
const env = requireEnv(loadEnv(), ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
async function main() {
  const sb = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: 'demo@azentio.test', password: 'Password123!' });
  const { data: sessions } = await sb.from('chat_sessions').select('id, created_at, last_message_at').order('created_at');
  for (const s of sessions ?? []) {
    const { data: msgs } = await sb.from('chat_messages').select('role, content, created_at').eq('session_id', s.id).order('created_at');
    console.log(`\nsession ${s.id.slice(0, 8)}  created ${s.created_at.slice(11, 19)}  last ${s.last_message_at.slice(11, 19)}  (${msgs?.length ?? 0} msgs)`);
    for (const m of msgs ?? []) console.log(`   ${m.created_at.slice(11, 19)} ${m.role.padEnd(9)} ${m.content.slice(0, 70)}`);
  }
}
main();
