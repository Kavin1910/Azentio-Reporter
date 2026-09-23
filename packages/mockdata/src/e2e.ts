/**
 * End-to-end run against the LIVE Supabase project, as a real user.
 *
 * Signs in with the anon key (the same path the app uses, so RLS applies),
 * then drives the exact pipeline code the server actions call:
 *   upload sample → Structure → pick template → approve → generate report
 * and finally hits the running app over HTTP with a real session cookie to
 * prove the page renders and the chat route answers.
 *
 *   pnpm --filter @azentio/mockdata e2e
 */

import { createClient } from '@supabase/supabase-js';
import { resolve } from 'node:path';
import type { Database } from '@azentio/core';
import * as P from '@azentio/pipeline';
import { loadEnv, requireEnv } from './env';

const env = requireEnv(loadEnv(), ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL!, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const EMAIL = 'demo@azentio.test', PASSWORD = 'Password123!';
const MOCK_DIR = resolve(process.cwd(), '../../mock-data');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; };
const step = (s: string) => console.log(`\n${s}`);

async function main() {
  console.log(`\nE2E against ${URL_}\n`);
  const sb = createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (authErr || !auth.session) throw new Error(`sign-in failed: ${authErr?.message}`);
  const userId = auth.user!.id;
  check('signed in as demo user', true, EMAIL);

  // Start clean: remove earlier runs' datasets for this user.
  await sb.from('datasets').delete().eq('owner_id', userId);

  step('1 · Upload sample');
  const datasetId = await P.uploadSample(sb, userId, 'loan_master_2024.xlsx', MOCK_DIR);
  const ds = await P.getDataset(sb, datasetId);
  check('dataset created with raw rows', !!ds && ds.raw_row_count === 433, `${ds?.raw_row_count} raw rows`);

  step('2 · Structure');
  const t0 = Date.now();
  const out = await P.structureDataset(sb, datasetId, { useModel: true });
  check('structured', out.rows === 420 && out.columns === 14, `${out.columns} columns, ${out.rows} rows, ${Date.now() - t0}ms${out.modelAssisted ? ', model-assisted' : ''}`);
  const cols = await P.getColumns(sb, datasetId);
  check('canonical keys', ['loan_account_no', 'sanctioned_amount', 'disbursed_on', 'cibil_score', 'tenure_months'].every((k) => cols.some((c) => c.key === k)));
  check('tenure is a number, not a date', cols.find((c) => c.key === 'tenure_months')?.data_type === 'number');
  const dsCust = await P.getCustomisations(sb, datasetId, null);
  const kinds = new Set(dsCust.map((c) => c.kind));
  check('queue has row exclusion, type conflict and text split', kinds.has('row_exclusion') && kinds.has('type_conflict') && kinds.has('text_split'), [...kinds].join(', '));
  check('everything is pending — nothing auto-applied', dsCust.every((c) => c.status === 'pending'));

  step('3 · Template + auto-map');
  const { mappingId } = await P.selectTemplate(sb, datasetId, 'DISBURSEMENT');
  let all = await P.getCustomisations(sb, datasetId, mappingId);
  const mine = all.filter((c) => c.mapping_id === mappingId);
  const exact = mine.filter((c) => c.kind === 'field_mapping' && c.status === 'approved');
  check('exact matches auto-approved only', exact.length >= 5 && exact.every((c) => c.confidence === 100), `${exact.length} exact`);
  check('nothing fuzzy was auto-approved', mine.filter((c) => c.status === 'approved').every((c) => c.confidence === 100 || c.override));

  step('4 · Report BEFORE approvals (pending must not apply)');
  const before = await P.generateReport(sb, datasetId, 'DISBURSEMENT', {});
  check('totals row still counted while exclusion is pending', before.rowCount === 421, `${before.rowCount} rows`);
  check('report warns about pending items', before.pendingCount > 0 && before.warnings.some((w) => /pending/.test(w)), `${before.pendingCount} pending`);

  step('5 · Approve the dataset-level queue');
  for (const c of dsCust) await P.decideCustomisation(sb, c.id, 'approved');
  const after = await P.generateReport(sb, datasetId, 'DISBURSEMENT', {});
  check('totals row excluded once approved', after.rowCount === 420, `${after.rowCount} rows`);
  check('sanctioned total is a real number', typeof after.tiles.find((t) => t.key === 'sanctioned_amount')?.value === 'number');
  check('bar + pie charts produced', after.charts.map((c) => c.type).join(',') === 'bar,pie');
  check('grouped by branch', after.groups.some((g) => g.dimension === 'branch' && g.rows.length > 0));
  check('split column appears after approval', (await P.getCustomisations(sb, datasetId, null)).some((c) => c.kind === 'text_split' && c.status === 'approved'));

  step('6 · Date-range filter');
  const q1 = await P.generateReport(sb, datasetId, 'DISBURSEMENT', { date_column: 'disbursed_on', from: '2025-01-01', to: '2025-03-31' });
  check('filter narrows the rows', q1.rowCount > 0 && q1.rowCount < after.rowCount, `${q1.rowCount} of ${after.rowCount}`);

  step('7 · Derived field (age from DOB via Demographics template)');
  const demo = await P.selectTemplate(sb, datasetId, 'DEMOGRAPHICS');
  all = await P.getCustomisations(sb, datasetId, demo.mappingId);
  // This file has no DOB — age lives inside the free-text borrower cell. With the
  // split approved above, the part "age" is a real (virtual) column and the mapper
  // must find it directly rather than leaving the field unmapped.
  const ageMap = all.find((c) => c.mapping_id === demo.mappingId && c.target_key === 'age');
  check('age mapped from the approved split part', ageMap?.kind === 'field_mapping' && (ageMap.proposal as any).column === 'age', ageMap ? `${ageMap.kind} ← ${(ageMap.proposal as any).column ?? ''} (${ageMap.status})` : 'no mapping row');
  const demoReport = await P.generateReport(sb, datasetId, 'DEMOGRAPHICS', {});
  const ages = demoReport.table.rows.map((r) => r.age).filter((a) => typeof a === 'number') as number[];
  check('report carries numeric ages from the split', ages.length === 200 /* detail table cap */ && ages.every((a) => a >= 18 && a <= 70), `${ages.length} ages, e.g. ${ages.slice(0, 5).join(', ')}`);

  step('8 · App over HTTP with a real session cookie');
  const ref = new URL(URL_).hostname.split('.')[0];
  const session = { access_token: auth.session.access_token, refresh_token: auth.session.refresh_token, expires_at: auth.session.expires_at, expires_in: auth.session.expires_in, token_type: 'bearer', user: auth.user };
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const page = await fetch(`${APP}/?ds=${datasetId}&tpl=DISBURSEMENT`, { headers: { cookie }, redirect: 'manual' });
  const html = await page.text();
  // The sidebar lists every step, whichever one is open.
  check('workspace page renders for the signed-in user', page.status === 200 && html.includes('Structured schema') && html.includes('Customisation Layer'), `HTTP ${page.status}`);
  check('page shows the dataset name', html.includes('loan master 2024'));
  const reportPage = await (await fetch(`${APP}/?ds=${datasetId}&tpl=DISBURSEMENT&step=report`, { headers: { cookie } })).text();
  check('report step renders', reportPage.includes('Generate report'));
  const lockedStep = await (await fetch(`${APP}/?ds=${datasetId}&step=mapping`, { headers: { cookie } })).text();
  check('a locked step falls back rather than rendering empty', !lockedStep.includes('aria-current="step"') || /Template|Source/.test(lockedStep));

  const chat = await fetch(`${APP}/api/chat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ datasetId, message: 'Show a bar chart of total sanctioned amount by branch' }) });
  const text = await chat.text();
  const events = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];
  const chart = events.find((e) => e.t === 'chart');
  const doneEv = events.find((e) => e.t === 'done');
  const errEv = events.find((e) => e.t === 'error');
  check('chat route streams', chat.status === 200 && events.length > 0, `HTTP ${chat.status}, ${events.length} events${errEv ? ` — error: ${errEv.message}` : ''}`);
  check('assistant produced a chart', !!chart && chart.chart.type === 'bar' && chart.chart.labels.length > 0, chart ? `${chart.chart.labels.length} bars` : 'no chart event');
  check('assistant wrote text', events.some((e) => e.t === 'text'));
  let visible = '';
  for (const e of events) { if (e.t === 'text') visible += e.d; else if (e.t === 'retract') visible = ''; }
  check('pre-tool narration is retracted from the visible answer', !/^\s*(let me|i'll|i will|first,)/i.test(visible), visible.slice(0, 70));
  if (doneEv) console.log(`        ttft ${doneEv.ttftMs}ms · total ${doneEv.totalMs}ms · cached ${doneEv.cacheReadTokens} · tools ${doneEv.toolsUsed.join(',')}`);

  const offtopic = await fetch(`${APP}/api/chat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ datasetId, message: 'What is the capital of France?' }) });
  const offText = (await offtopic.text()).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e: any) => e?.t === 'text').map((e: any) => e.d).join('');
  check('off-topic question is declined', /only answer|loaded data|dataset/i.test(offText) && !/paris/i.test(offText), offText.slice(0, 90));

  step('9 · Conversation history: list, resume, delete');
  const list = await (await fetch(`${APP}/api/chat/sessions?datasetId=${datasetId}`, { headers: { cookie } })).json();
  check('sessions listed with previews', Array.isArray(list.sessions) && list.sessions.length >= 2 && list.sessions[0].preview.length > 0, `${list.sessions?.length} sessions · "${list.sessions?.[0]?.preview?.slice(0, 40)}"`);
  // Newest first means the off-topic question is [0]; pick the one that asked for a chart.
  const first = list.sessions.find((x: any) => /chart/i.test(x.preview)) ?? list.sessions[0];
  const loaded = await (await fetch(`${APP}/api/chat/sessions/${first.id}`, { headers: { cookie } })).json();
  check('a session reloads with its messages and chart', loaded.messages?.length === first.message_count && loaded.messages.some((m: any) => m.chart), `${loaded.messages?.length} messages`);
  const del = await fetch(`${APP}/api/chat/sessions/${first.id}`, { method: 'DELETE', headers: { cookie } });
  const afterDelete = await (await fetch(`${APP}/api/chat/sessions?datasetId=${datasetId}`, { headers: { cookie } })).json();
  check('deleting a session removes it', del.status === 200 && afterDelete.sessions.length === list.sessions.length - 1, `${list.sessions.length} → ${afterDelete.sessions.length}`);
  const gone = await fetch(`${APP}/api/chat/sessions/${first.id}`, { headers: { cookie } });
  check('deleted session is 404', gone.status === 404);
  const delAll = await fetch(`${APP}/api/chat/sessions?datasetId=${datasetId}`, { method: 'DELETE', headers: { cookie } });
  const none = await (await fetch(`${APP}/api/chat/sessions?datasetId=${datasetId}`, { headers: { cookie } })).json();
  check('delete-all clears the history', delAll.status === 200 && none.sessions.length === 0);
  // Leave one conversation behind so the UI has something to show.
  await fetch(`${APP}/api/chat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ datasetId, message: 'Show a pie chart of sanctioned amount by product' }) }).then((r) => r.text());
  await fetch(`${APP}/api/chat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ datasetId, message: 'How many loans were disbursed in March 2025?' }) }).then((r) => r.text());

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nE2E error:', e instanceof Error ? e.message : e); process.exit(1); });
