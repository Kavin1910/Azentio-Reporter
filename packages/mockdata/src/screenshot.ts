/**
 * Full-page screenshots of the running app via Chrome's DevTools protocol.
 * No Playwright: spawns the installed Chrome headless, sets the session
 * cookie, navigates and captures. Output in the scratchpad.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@azentio/core';
import { loadEnv, requireEnv } from './env';

const env = requireEnv(loadEnv(), ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const OUT = process.env.SHOT_DIR ?? '/tmp';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

async function cdp() {
  const chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, '--window-size=1440,1000', '--hide-scrollbars', '--no-first-run', '--user-data-dir=/tmp/az-chrome-profile', 'about:blank'], { stdio: 'ignore' });
  let ws: string | null = null;
  for (let i = 0; i < 50 && !ws; i++) {
    try { ws = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!ws) throw new Error('Chrome did not expose a debugging endpoint.');
  const sock = new WebSocket(ws);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const events: Array<(m: any) => void> = [];
  sock.onmessage = (m) => { const d = JSON.parse(String(m.data)); if (d.id && pending.has(d.id)) { pending.get(d.id)!(d); pending.delete(d.id); } else events.forEach((f) => f(d)); };
  const send = (method: string, params: any = {}, sessionId?: string) => new Promise<any>((res) => { const i = ++id; pending.set(i, res); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });
  return { send, events, close: () => { sock.close(); chrome.kill(); } };
}

async function main() {
  const sb = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: auth } = await sb.auth.signInWithPassword({ email: 'demo@azentio.test', password: 'Password123!' });
  // The newest dataset may be a raw import; the screens worth capturing need a structured one.
  const { data: ds } = await sb.from('datasets').select('id').eq('status', 'structured').order('created_at', { ascending: false }).limit(1).single();
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0];
  const s = auth!.session!;
  const cookieValue = `base64-${Buffer.from(JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, token_type: 'bearer', user: auth!.user })).toString('base64url')}`;

  const { send, events, close } = await cdp();
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
  await send('Page.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Network.setCookie', { name: `sb-${ref}-auth-token`, value: cookieValue, url: APP, path: '/' }, sessionId);

  const shots: Array<[string, string]> = [
    ['login', `${APP}/login`],
    ['workspace', `${APP}/?ds=${ds!.id}&tpl=DISBURSEMENT&step=report`],
    // One viewport-height capture per workflow step.
    ...(['source', 'schema', 'template', 'mapping', 'review', 'report'] as const)
      .map((st): [string, string] => [`step-${st}`, `${APP}/?ds=${ds!.id}&tpl=DISBURSEMENT&step=${st}`]),
  ];
  for (const [name, url] of shots) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = new Promise<void>((res) => { const f = (m: any) => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) { events.splice(events.indexOf(f), 1); res(); } }; events.push(f); });
    await send('Page.navigate', { url }, sessionId);
    await loaded;
    await new Promise((r) => setTimeout(r, 1800)); // fonts + hydration
    if (name === 'workspace') {
      // Open the assistant so the widget is in the capture too.
      await send('Runtime.evaluate', { expression: `document.querySelector('[aria-controls="assistant-panel"]')?.click()` }, sessionId);
      await new Promise((r) => setTimeout(r, 400));
    }
    // Viewport shots first: fixed elements are only meaningful at real viewport
    // size — a full-page capture parks them at the document's end and hides
    // exactly the kind of positioning bug a floating widget can have.
    if (name === 'workspace') {
      // Drive the widget by its ARIA state rather than blind toggling, so each
      // capture is the state its filename claims.
      const setPanel = async (wantOpen: boolean) => {
        await send('Runtime.evaluate', { expression: `(() => { const b = document.querySelector('[aria-controls="assistant-panel"]'); if (b && (b.getAttribute('aria-expanded') === 'true') !== ${wantOpen}) b.click(); })()` }, sessionId);
        await new Promise((r) => setTimeout(r, 1500));
      };
      const snap = async (file: string) => {
        const shot = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)).result;
        writeFileSync(`${OUT}/${file}.png`, Buffer.from(shot.data, 'base64'));
      };
      await send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight)' }, sessionId);
      await new Promise((r) => setTimeout(r, 400));
      await setPanel(false); await snap('panel-closed');
      await setPanel(true);  await snap('panel-open');
      // Hold the mic: headless Chrome has no microphone, so this exercises the
      // listening state or the error path — either way the UI must stay intact.
      const mic = (await send('Runtime.evaluate', { returnByValue: true, expression:
        `(() => { const el = document.querySelector('#assistant-panel .ptt-btn'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, disabled: el.disabled }; })()` }, sessionId)).result.result.value;
      if (mic && !mic.disabled) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mic.x, y: mic.y }, sessionId);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mic.x, y: mic.y, button: 'left', clickCount: 1 }, sessionId);
        await new Promise((r) => setTimeout(r, 900));
        await snap('panel-ptt-holding');
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mic.x, y: mic.y, button: 'left', clickCount: 1 }, sessionId);
        await new Promise((r) => setTimeout(r, 1200));
        await snap('panel-ptt-released');
        console.log('  panel-ptt-holding.png / panel-ptt-released.png');
      } else console.log(`  mic button: ${mic ? 'disabled (unsupported)' : 'not found'}`);
      await send('Runtime.evaluate', { expression: `document.querySelector('#assistant-panel [aria-label="History"]')?.click()` }, sessionId);
      await new Promise((r) => setTimeout(r, 900));
      await snap('panel-history');
      console.log('  panel-closed.png / panel-open.png / panel-history.png  1440×1000');
      await setPanel(false);
      await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' }, sessionId);
    }
    if (name.startsWith('step-')) {
      const shot = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)).result;
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'));
      console.log(`  ${name}.png  1440×1000`);

      // Hover captures: the tooltip used to clip at card and panel edges.
      const hover = async (selector: string, file: string) => {
        const { result } = await send('Runtime.evaluate', { returnByValue: true, expression:
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()` }, sessionId);
        const pt = result.result.value;
        if (!pt) { console.log(`  (no element for ${selector})`); return; }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y }, sessionId);
        await new Promise((r) => setTimeout(r, 350));
        const shot2 = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)).result;
        writeFileSync(`${OUT}/${file}.png`, Buffer.from(shot2.data, 'base64'));
        console.log(`  ${file}.png  (hover ${selector})`);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }, sessionId);
      };
      if (name === 'step-mapping') {
        // Collapsed sidebar rail.
        await send('Runtime.evaluate', { expression: `document.querySelector('[aria-label="Collapse sidebar"]')?.click()` }, sessionId);
        await new Promise((r) => setTimeout(r, 500));
        const rail = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)).result;
        writeFileSync(`${OUT}/sidebar-collapsed.png`, Buffer.from(rail.data, 'base64'));
        await send('Runtime.evaluate', { expression: `document.querySelector('[aria-label="Expand sidebar"]')?.click()` }, sessionId);
        await new Promise((r) => setTimeout(r, 400));
        console.log('  sidebar-collapsed.png');
        // A template with no mapping yet: auto-map must run on its own.
        await send('Page.navigate', { url: `${APP}/?ds=${ds!.id}&tpl=CONCENTRATION&step=mapping` }, sessionId);
        await new Promise((r) => setTimeout(r, 4500));
        const fresh = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)).result;
        writeFileSync(`${OUT}/mapping-automapped.png`, Buffer.from(fresh.data, 'base64'));
        const inForce = (await send('Runtime.evaluate', { returnByValue: true, expression: `(document.body.innerText.match(/(\\d+) \\/ (\\d+) in force/) || [])[0] || 'n/a'` }, sessionId)).result.result.value;
        console.log(`  mapping-automapped.png — ${inForce}`);
      }
      if (name === 'step-review') {
        // The Override button sits at the card's right edge — the clipping case.
        await hover('[data-tip^="Change the proposed value"] button', 'hover-override');
      }
      if (name === 'step-source') {
        await send('Runtime.evaluate', { expression: `document.querySelector('[aria-controls="assistant-panel"]')?.click()` }, sessionId);
        await new Promise((r) => setTimeout(r, 1500));
        await send('Runtime.evaluate', { expression: `document.querySelector('#assistant-panel [aria-label="History"]')?.click()` }, sessionId);
        await new Promise((r) => setTimeout(r, 800));
        await hover('#assistant-panel li [aria-label="Delete"]', 'hover-history-delete');
        await hover('#assistant-panel [aria-label="Delete all conversations"]', 'hover-history-delete-all');
      }
      continue;
    }
    const metrics = (await send('Page.getLayoutMetrics', {}, sessionId)).result;
    const height = Math.min(Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height), 6000);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    const shot = (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)).result;
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`  ${name}.png  ${1440}×${height}`);
  }
  close();
}
main().catch((e) => { console.error(e); process.exit(1); });
