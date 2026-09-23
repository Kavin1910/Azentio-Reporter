import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export interface SessionSummary {
  id: string;
  created_at: string;
  last_message_at: string;
  preview: string;
  message_count: number;
}

/** GET ?datasetId= — this dataset's conversations, newest first. RLS scopes to the owner. */
export async function GET(request: Request) {
  const sb = await getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const datasetId = new URL(request.url).searchParams.get('datasetId');
  if (!datasetId) return NextResponse.json({ error: 'datasetId is required.' }, { status: 400 });

  const { data: sessions, error } = await sb.from('chat_sessions').select('id, created_at, last_message_at')
    .eq('dataset_id', datasetId).order('last_message_at', { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!sessions?.length) return NextResponse.json({ sessions: [] });

  // One query for previews and counts rather than one per session.
  const { data: msgs } = await sb.from('chat_messages').select('session_id, role, content, created_at')
    .in('session_id', sessions.map((s) => s.id)).order('created_at');

  const byId = new Map<string, { preview: string; count: number }>();
  for (const m of msgs ?? []) {
    const cur = byId.get(m.session_id) ?? { preview: '', count: 0 };
    cur.count++;
    if (!cur.preview && m.role === 'user') cur.preview = m.content.slice(0, 90);
    byId.set(m.session_id, cur);
  }

  const out: SessionSummary[] = sessions
    .map((s) => ({ ...s, preview: byId.get(s.id)?.preview ?? '', message_count: byId.get(s.id)?.count ?? 0 }))
    // A session with no messages is one that was opened and abandoned; hide it.
    .filter((s) => s.message_count > 0);

  return NextResponse.json({ sessions: out });
}

/** DELETE ?datasetId= — clears every conversation for the dataset. */
export async function DELETE(request: Request) {
  const sb = await getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const datasetId = new URL(request.url).searchParams.get('datasetId');
  if (!datasetId) return NextResponse.json({ error: 'datasetId is required.' }, { status: 400 });

  const { error, count } = await sb.from('chat_sessions').delete({ count: 'exact' }).eq('dataset_id', datasetId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: count ?? 0 });
}
