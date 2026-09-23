import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** GET — a conversation's messages, including any charts the assistant drew. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  // RLS: a session the caller does not own does not come back → 404, not 403.
  const { data: session } = await sb.from('chat_sessions').select('id, dataset_id').eq('id', id).maybeSingle();
  if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });

  const { data, error } = await sb.from('chat_messages').select('id, role, content, chart, created_at')
    .eq('session_id', id).in('role', ['user', 'assistant']).order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ session, messages: data ?? [] });
}

/** DELETE — removes the conversation and, by cascade, its messages. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { error, count } = await sb.from('chat_sessions').delete({ count: 'exact' }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  return NextResponse.json({ deleted: count });
}
