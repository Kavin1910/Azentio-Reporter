'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { Tip } from '@/components/tip';
import { Mark, Wordmark } from '@/components/logo';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const sb = getBrowserSupabase();
    const { error } = mode === 'signin'
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) { setError(error.message); setBusy(false); return; }
    router.replace('/'); router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-[380px] rise">
        <div className="mb-8 flex flex-col items-center text-center">
          <Mark size={56} className="mb-4 rounded-[15px] shadow-[var(--shadow)]" />
          <h1 className="m-0"><Wordmark /></h1>
          <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">
            {mode === 'signin' ? 'Sign in to your workspace' : 'Create a workspace account'}
          </p>
        </div>

        <form onSubmit={submit} className="surface px-6 py-6 shadow-[var(--shadow)]">
          {mode === 'signup' && (
            <label className="mb-4 block">
              <span className="label">Full name</span>
              <input className="field mt-1.5" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
            </label>
          )}
          <label className="mb-4 block">
            <span className="label">Email</span>
            <input type="email" className="field mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input type="password" className="field mt-1.5" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
          </label>

          {error && (
            <p role="alert" className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-danger-soft)] px-3 py-2 text-[12.5px] text-[var(--color-danger-text)]">{error}</p>
          )}

          <Tip text={mode === 'signin' ? 'Sign in with your email and password' : 'Creates your account and signs you in'} className="mt-5 w-full">
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </Tip>
        </form>

        <p className="mt-5 text-center text-[12.5px] text-[var(--color-ink-muted)]">
          {mode === 'signin' ? "Don't have an account? " : 'Already registered? '}
          <button type="button" className="font-semibold text-[var(--color-brand)] hover:underline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}>
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
