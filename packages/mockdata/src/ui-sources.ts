/**
 * Drives the Source step in a real (headless) browser via CDP:
 *   1. uploads a file through the actual <input type=file> and server action
 *   2. connects to a database through the UI, tests, imports a table
 * and captures each screen. This is the path the user clicks, not the pipeline
 * called directly — so it catches wiring bugs the pipeline tests cannot.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@azentio/core';
import { loadEnv, requireEnv } from './env';

const env = requireEnv(loadEnv(), ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const OUT = process.env.SHOT_DIR ?? '/tmp';
const FILE = resolve(process.cwd(), '../../mock-data/bureau_extract.xlsx');
let failures = 0;
const check = (l: string, ok: boolean, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ` — ${d}` : ''}`); if (!ok) failures++; };

async function main() {
  const sb = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: auth } = await sb.auth.signInWithPassword({ email: 'demo@azentio.test', password: 'Password123!' });
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]; const s = auth!.session!;
  const cookieValue = `base64-${Buffer.from(JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, token_type: 'bearer', user: auth!.user })).toString('base64url')}`;
  const before = (await sb.from('datasets').select('id')).data?.length ?? 0;

  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9335', '--window-size=1440,1000', '--hide-scrollbars', '--user-data-dir=/tmp/az-ui-sources', 'about:blank'], { stdio: 'ignore' });
  let ws: string | null = null;
  for (let i = 0; i < 50 && !ws; i++) { try { ws = (await (await fetch('http://127.0.0.1:9335/json/version')).json()).webSocketDebuggerUrl; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const sock = new WebSocket(ws!); await new Promise((res) => (sock.onopen = res));
  let id = 0; const pending = new Map<number, (v: any) => void>();
  sock.onmessage = (m) => { const d = JSON.parse(String(m.data)); if (d.id && pending.has(d.id)) { pending.get(d.id)!(d); pending.delete(d.id); } };
  const send = (method: string, params: any = {}, sessionId?: string) => new Promise<any>((res) => { const i = ++id; pending.set(i, res); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId); await send('DOM.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
  await send('Network.setCookie', { name: `sb-${ref}-auth-token`, value: cookieValue, url: APP, path: '/' }, sessionId);
  const ev = async (expr: string) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.result.value;
  const snap = async (f: string) => { const r = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)).result; writeFileSync(`${OUT}/${f}.png`, Buffer.from(r.data, 'base64')); };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const clickText = async (sel: string, text: string) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; if (el.disabled) return 'disabled'; el.click(); return true; })()`);
  // Server actions call router.refresh(); until that lands, action buttons are disabled.
  const idle = async () => { for (let i = 0; i < 40; i++) { if (!(await ev(`!!document.querySelector('.pulsing')`))) return; await wait(250); } };
  const type = async (sel: string, value: string) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

  await send('Page.navigate', { url: `${APP}/?step=source` }, sessionId); await wait(2500);

  console.log('\nSource · upload through the browser');
  await clickText('button', 'Upload a file'); await wait(300);
  await snap('source-upload');
  const { root } = (await send('DOM.getDocument', {}, sessionId)).result;
  const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' }, sessionId)).result;
  await send('DOM.setFileInputFiles', { nodeId, files: [FILE] }, sessionId);
  // The action parses, persists and navigates to the new dataset.
  let landed = false;
  for (let i = 0; i < 40 && !landed; i++) { await wait(500); landed = /ds=/.test(String(await ev('location.href'))) && /bureau extract/i.test(String(await ev('document.body.innerText'))); }
  check('file upload via the UI created and opened a dataset', landed, String(await ev('location.href')).replace(APP, ''));
  const after = (await sb.from('datasets').select('id, name, source_filename, raw_row_count').order('created_at', { ascending: false })).data ?? [];
  const mine = after[0];
  check('dataset row stored with the file name and rows', after.length === before + 1 && mine?.source_filename === 'bureau_extract.xlsx' && (mine?.raw_row_count ?? 0) > 400, `${mine?.name} · ${mine?.raw_row_count} raw rows`);

  console.log('\nSource · saved datasets tab');
  await clickText('button', 'Saved datasets'); await wait(400);
  check('saved tab lists the upload', /bureau_extract\.xlsx/.test(String(await ev('document.body.innerText'))));
  await snap('source-saved');

  console.log('\nSource · connect Supabase (this workspace\'s own project, via REST)');
  const svc = requireEnv(loadEnv(), ['SUPABASE_SERVICE_ROLE_KEY']).SUPABASE_SERVICE_ROLE_KEY!;
  await clickText('button', 'Connect Supabase'); await wait(400);
  const hasNewBtn = await clickText('button', '+ New connection'); if (hasNewBtn === true) await wait(300);
  await type('input[placeholder="https://abcd1234.supabase.co"]', env.NEXT_PUBLIC_SUPABASE_URL!);
  await ev(`(() => { const el=document.querySelector('input[type=password]'); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(el,${JSON.stringify(svc)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await idle();
  const clickedTest = await clickText('button', 'Get schema');
  check('Get schema button enabled and clicked', clickedTest === true, String(clickedTest));
  let text = '';
  for (let i = 0; i < 40; i++) { await wait(500); text = String(await ev('document.body.innerText')); if (/Connected|Could not connect/.test(text)) break; }
  check('schema read: tables listed with columns', /Connected/.test(text) && /report_templates/.test(text) && /datasets/.test(text), (text.match(/Connected in \d+ms[^\n]*/) ?? [''])[0]);
  await snap('source-supabase-schema');
  await idle();
  const picked = await ev(`(() => { const row=[...document.querySelectorAll('tr')].find(r => r.textContent.trim().startsWith('report_templates')); if(!row) return false; row.click(); return true; })()`);
  check('clicking a table shows its columns', picked === true && /fields/.test(String(await ev('document.body.innerText'))));
  await type('input[placeholder="report_templates"]', 'templates via supabase');
  const clickedImport = await clickText('button', 'Import as dataset');
  check('Import button enabled and clicked', clickedImport === true, String(clickedImport));
  landed = false;
  for (let i = 0; i < 80 && !landed; i++) { await wait(500); const b = String(await ev('document.body.innerText')); landed = /templates via supabase/i.test(b) && /13 raw rows/.test(b); }
  check('Supabase import created a dataset (header + 12 rows)', landed, landed ? '' : String(await ev('location.href')).replace(APP, ''));
  await snap('source-supabase-imported');

  console.log('\nChat · composer layout');
  // The assistant only mounts on a structured dataset.
  const structured = (await sb.from('datasets').select('id').eq('status', 'structured').order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  await send('Page.navigate', { url: `${APP}/?ds=${structured?.id}&step=report` }, sessionId); await wait(2500);
  await ev(`document.querySelector('[aria-controls="assistant-panel"]')?.click()`); await wait(1500);
  const order = await ev(`(() => { const form=document.querySelector('#assistant-panel form'); if(!form) return null; const row=form.querySelector('.flex.items-end'); return [...row.children].map(c => c.querySelector('textarea') ? 'textarea' : c.querySelector('.ptt-btn') ? 'mic' : c.querySelector('[type=submit]') ? 'send' : c.tagName.toLowerCase()); })()`);
  check('composer order is textarea → mic → send', JSON.stringify(order) === JSON.stringify(['textarea', 'mic', 'send']), JSON.stringify(order));
  await snap('chat-composer');

  sock.close(); chrome.kill();
  console.log(failures === 0 ? '\nAll UI checks passed.\n' : `\n${failures} UI check(s) FAILED.\n`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
