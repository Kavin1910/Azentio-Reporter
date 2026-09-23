'use client';

import { useEffect } from 'react';

/** Route-level error boundary: a readable failure with a retry, never a blank page. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="surface max-w-[440px] px-6 py-6 text-center shadow-[var(--shadow)]">
        <p className="label">Something went wrong</p>
        <h1 className="display mt-1 text-[22px]">This page could not be shown</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          The error has been logged{error.digest ? ` (ref ${error.digest})` : ''}. Your data is unaffected.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn btn-primary" onClick={reset}>Try again</button>
          <a className="btn btn-ghost" href="/">Go to workspace</a>
        </div>
      </div>
    </div>
  );
}
