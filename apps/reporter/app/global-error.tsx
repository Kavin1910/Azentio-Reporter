'use client';

/** Last resort when the root layout itself fails. Must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f6f5f1', color: '#101613', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ maxWidth: 440, textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Azentio Reporter hit an unexpected error</h1>
          <p style={{ fontSize: 14, color: '#56645b' }}>Reference {error.digest ?? 'n/a'}. Your data is unaffected.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: '9px 16px', borderRadius: 8, border: 0, background: '#344e41', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Reload</button>
        </div>
      </body>
    </html>
  );
}
