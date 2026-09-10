import { useState } from 'react';
import { Button } from '@/src/shared/ui';
import type { ApiExchange } from './demoApi';

export function ApiPresenter({ entries, quoteId, retrieve }: { entries: ApiExchange[]; quoteId?: string; retrieve: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(),
      partnerId: 'summit-rentals-demo', quoteId, environment: 'demo',
      note: 'Captured public adapter traffic. Partner API uses the same quote service. Payment and bind are simulated; no policy is issued. Renter contact details remain in the form.',
      exchanges: entries }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `bonzah-${quoteId || 'session'}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <aside className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)]">
    <Button onClick={() => setOpen(!open)} aria-expanded={open} className="bg-slate-900 text-white">{open ? 'Close integration details' : 'Integration details'}</Button>
    {open && <section aria-label="Bonzah API activity" className="mt-2 max-h-[70vh] w-[640px] max-w-full overflow-auto rounded-xl border bg-white p-5 text-slate-900 shadow-xl">
      <h2 className="text-xl font-bold">Bonzah API · Presenter view</h2>
      <p className="my-3 text-sm">Live requests and responses from this browser session. Payment verification and binding are simulated. No policy is issued.</p>
      <p className="mb-3 text-sm">Summit uses the public adapter. In Postman, retrieve the same quote through <code>/api/v1/bonzah/quotes/{quoteId || '{quoteId}'}</code> with partner ID <code>summit-rentals-demo</code>.</p>
      <div className="flex gap-2">
        <Button disabled={!entries.length} onClick={download}>Download JSON</Button>
        <Button disabled={!quoteId || busy} onClick={async () => { setBusy(true); setError(''); try { await retrieve(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Retrieval failed.'); } finally { setBusy(false); } }}>Retrieve current quote</Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!entries.length && <p className="mt-3">Start the rental journey to capture API activity.</p>}
      {entries.map(entry => <details key={entry.id} className="mt-3 rounded border p-3">
        <summary className="cursor-pointer break-all text-sm font-semibold">{entry.method} {entry.path} · {entry.status || 'Network error'} · {entry.durationMs} ms</summary>
        <pre className="mt-3 overflow-auto text-xs">{JSON.stringify(entry, null, 2)}</pre>
      </details>)}
    </section>}
  </aside>;
}
