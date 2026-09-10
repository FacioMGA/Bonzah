import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { getPolicyDocumentTypeLabel } from '@/src/modules/policies/model/policyDisplayLabels';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import { openClientDocument } from '@/src/surfaces/client/lib/openClientDocument';

type ClientDoc = { id?: string; type?: string; filename?: string; publicUrl?: string; storageUri?: string };

function resolveClientDocumentHref(doc: ClientDoc, authToken: string | null): string {
  const publicUrl = String(doc.publicUrl || '').trim();
  const storageUri = String(doc.storageUri || '').trim();
  if (authToken && storageUri.startsWith('/api/documents/')) return storageUri;
  if (publicUrl) return publicUrl;
  return storageUri;
}

export default function ClientPolicyDocumentsPage() {
  const navigate = useNavigate();
  const { policyId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [docs, setDocs] = useState<ClientDoc[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!policyId) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.listPolicyDocuments(policyId);
        setDocs(res.success && res.data && Array.isArray(res.data) ? (res.data as ClientDoc[]) : []);
      } catch (e) {
        setError((e as Error).message || 'Failed to load documents');
      } finally {
        setLoading(false);
      }
    })();
  }, [policyId]);

  const selectedDocs = useMemo(
    () => docs.filter((d) => selectedDocIds.has(String(d.id || d.filename || ''))),
    [docs, selectedDocIds],
  );

  const authToken = useMemo(() => {
    try {
      return localStorage.getItem('auth_token');
    } catch {
      return null;
    }
  }, []);

  const backToPolicy = () => navigate(`/client?policy=${encodeURIComponent(policyId)}`);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <PageHeader
        breadcrumb={{ label: 'Back to policy', onClick: backToPolicy }}
        title="Policy Documents"
        subtitle="View and share files for this policy."
      />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-400 font-medium">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-lg font-black text-slate-900">No documents available</div>
          <div className="mt-2 text-sm font-semibold text-slate-600">Documents will appear here once generated.</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedDocIds(new Set(docs.map((d) => String(d.id || d.filename || ''))))}
              className="text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700"
            >
              Select all
            </Button>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  selectedDocs.forEach((d) => {
                    const href = resolveClientDocumentHref(d, authToken);
                    if (href) void openClientDocument(href, { inline: false });
                  });
                }}
                disabled={selectedDocs.length === 0}
              >
                Download selected
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  if (!policyId || selectedDocs.length === 0) return;
                  try {
                    setSending(true);
                    const ids = selectedDocs.map((d) => String(d.id || '')).filter(Boolean);
                    const res = await api.emailPolicyDocuments(policyId, ids);
                    if (!res.success) throw new Error(res.error?.message || 'Failed to email documents');
                  } catch (e) {
                    setError((e as Error).message || 'Failed to email documents');
                  } finally {
                    setSending(false);
                  }
                }}
                disabled={selectedDocs.length === 0 || sending}
              >
                {sending ? 'Sending…' : 'Email selected'}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {docs.map((d) => {
              const key = String(d.id || d.filename || Math.random());
              const href = resolveClientDocumentHref(d, authToken);
              const checked = selectedDocIds.has(key);
              return (
                <div key={key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm flex items-center justify-between gap-3">
                  <label className="flex items-center gap-3 min-w-0 flex-1">
                    <Input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedDocIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        });
                      }}
                      className="h-4 w-4 accent-brand-primary"
                    />
                    <div className="min-w-0">
                      <div className="font-black text-slate-900">{getPolicyDocumentTypeLabel(String(d.type || ''))}</div>
                      <div className="text-sm font-semibold text-slate-600 truncate">{String(d.filename || 'File')}</div>
                    </div>
                  </label>
                  <Button
                    type="button"
                    variant="link"
                    size="none"
                    disabled={!href}
                    onClick={() => { if (href) void openClientDocument(href); }}
                    className="text-xs font-black uppercase tracking-widest text-brand-primary hover:underline"
                  >
                    View
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
