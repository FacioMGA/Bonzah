import React from 'react';
import { Button, PageHeader } from '@/src/shared/ui';

export function WorkspaceApiView() {
  return (
    <div className="ui-page max-w-4xl space-y-8">
      <PageHeader
        title="Open API"
        subtitle="Public API access, documentation, and future credential controls for the workspace."
        status={{ label: 'Documentation-first', tone: 'info' }}
      />

      <section className="ui-card ui-card-pad space-y-4">
        <h2 className="text-lg font-black text-slate-900">API Reference</h2>
        <p className="text-sm text-slate-500">
          The current public API reference is served through the existing Scalar documentation surface.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/v1/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:bg-black"
          >
            Open API docs
          </a>
        </div>
      </section>

      <section className="ui-card ui-card-pad space-y-4">
        <h2 className="text-lg font-black text-slate-900">Credentials</h2>
        <p className="text-sm text-slate-500">
          API key visibility and regeneration are intentionally future-scoped until a workspace key contract is available.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            API key management will appear here when the credential surface is implemented.
          </div>
          <Button variant="secondary" disabled>
            Regenerate
          </Button>
        </div>
      </section>
    </div>
  );
}
