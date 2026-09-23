/** Route transition skeleton: the shell stays visible while the next step loads. */
export default function Loading() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading">
      <aside className="hidden border-r border-[var(--color-line)] bg-[var(--color-paper)] lg:block" />
      <div className="mx-auto w-full max-w-[1180px] px-6 pt-8 lg:px-10">
        <div className="h-3 w-24 rounded bg-[var(--color-dust-700)] pulsing" />
        <div className="mt-3 h-8 w-64 rounded bg-[var(--color-dust-700)] pulsing" />
        <div className="mt-6 h-[320px] rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-paper)]" />
      </div>
    </div>
  );
}
