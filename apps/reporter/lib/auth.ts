import { redirect } from 'next/navigation';
import type { Profile } from '@azentio/core';
import { getServerSupabase } from './supabase/server';

export async function getSessionProfile(): Promise<Profile | null> {
  const sb = await getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  // The signup trigger creates the profile; if it has not landed yet, synthesise
  // one rather than bouncing a freshly signed-up user back to the login screen.
  return data ?? { id: user.id, full_name: user.email?.split('@')[0] ?? null, created_at: new Date().toISOString() };
}

export async function requireUser(): Promise<Profile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  return profile;
}
