import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="surface max-w-[420px] px-6 py-6 text-center shadow-[var(--shadow)]">
        <p className="label">404</p>
        <h1 className="display mt-1 text-[22px]">There is nothing here</h1>
        <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">The page may have moved, or the link was mistyped.</p>
        <Link href="/" className="btn btn-primary mt-5">Go to workspace</Link>
      </div>
    </div>
  );
}
