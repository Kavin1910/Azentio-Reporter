/** Authenticated HTTP checks that only make sense against a production server. */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@azentio/core';
import { loadEnv, requireEnv } from './env';
const env = requireEnv(loadEnv(), ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
const APP = process.env.APP_URL ?? 'http://localhost:3000';
let failures = 0;
const check = (l: string, ok: boolean, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ` — ${d}` : ''}`); if (!ok) failures++; };
async function main() {
  const sb = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: auth } = await sb.auth.signInWithPassword({ email: 'demo@azentio.test', password: 'Password123!' });
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]; const s = auth!.session!;
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, token_type: 'bearer', user: auth!.user })).toString('base64url')}`;
  const H = { cookie, 'content-type': 'application/json' };

  const login = await fetch(`${APP}/login`, { headers: { cookie }, redirect: 'manual' });
  check('signed-in visitor on /login is redirected to the workspace (307)', login.status === 307 && /\/$|\/\?/.test(login.headers.get('location') ?? ''), `${login.status} → ${login.headers.get('location')}`);

  const bad = await fetch(`${APP}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify({ datasetId: 'not-a-uuid', message: 'hi' }) });
  check('chat rejects a malformed id with 400', bad.status === 400);

  const long = await fetch(`${APP}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify({ datasetId: '11111111-1111-4111-8111-111111111111', message: 'x'.repeat(2001) }) });
  check('chat rejects an over-long message with 413', long.status === 413);

  // Rate limit: 30/min per user. A random (valid-format) dataset id 404s AFTER the limiter, so no model calls are made.
  let last = 0, hit429 = 0;
  for (let i = 0; i < 32; i++) { const r = await fetch(`${APP}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify({ datasetId: '11111111-1111-4111-8111-111111111111', message: 'ping' }) }); last = r.status; if (r.status === 429) hit429++; }
  check('chat rate limit engages at 30 requests/minute', hit429 >= 2 && last === 429, `${hit429} × 429, last ${last}`);

  const html = await (await fetch(`${APP}/`, { headers: { cookie } })).text();
  check('workspace renders for a signed-in user in production', /Azentio/.test(html) && /Source/.test(html) && !/An error occurred/.test(html));
  check('no dev-only markup in production HTML', !/nextjs-portal|__nextjs_dev/.test(html));

  console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll production checks passed.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
