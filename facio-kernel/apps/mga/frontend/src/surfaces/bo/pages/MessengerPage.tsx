import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { CommunicationsTab } from '@/src/modules/communications/views/CommunicationsTab';
import { Button } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { StaffMessage } from '@/src/shared/api/boApiClient';

export default function MessengerPage() {
  const [showArchive, setShowArchive] = React.useState(false);
  const [archivedMessages, setArchivedMessages] = React.useState<StaffMessage[]>([]);
  const [archiveLoading, setArchiveLoading] = React.useState(false);
  const [archiveError, setArchiveError] = React.useState<string | null>(null);

  const loadArchive = React.useCallback(async () => {
    setArchiveLoading(true);
    setArchiveError(null);
    try {
      const response = await api.listArchivedStaffMessages();
      if (response.success && Array.isArray(response.data)) {
        setArchivedMessages(response.data);
      } else {
        setArchivedMessages([]);
        setArchiveError(response.error?.message || 'Failed to load archived messages.');
      }
    } catch (err) {
      setArchivedMessages([]);
      setArchiveError(err instanceof Error ? err.message : 'Failed to load archived messages.');
    } finally {
      setArchiveLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (showArchive) void loadArchive();
  }, [loadArchive, showArchive]);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Communications"
          subtitle="Office-level staff communications. Policy-specific messages remain on each policy workspace."
        />
        <Button
          type="button"
          variant={showArchive ? 'primary' : 'secondary'}
          size="md"
          onClick={() => setShowArchive((current) => !current)}
        >
          {showArchive ? 'Hide archive' : 'Archive'}
        </Button>
      </div>
      {showArchive && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-black text-slate-900">Archived staff messages</div>
              <div className="text-xs font-semibold text-slate-500 mt-1">Legacy staff-message archive, kept here instead of a separate page.</div>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadArchive()} disabled={archiveLoading}>
              {archiveLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          {archiveError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{archiveError}</div>}
          <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-100">
            {archiveLoading ? (
              <div className="px-4 py-6 text-center text-sm font-semibold text-slate-400">Loading archive...</div>
            ) : archivedMessages.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm font-semibold text-slate-400">No archived staff messages.</div>
            ) : archivedMessages.map((message) => (
              <div key={message.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black text-slate-800">{message.subject}</div>
                  <div className="text-[11px] font-semibold text-slate-400">{message.createdAt ? new Date(message.createdAt).toLocaleString() : '—'}</div>
                </div>
                <div className="mt-1 text-sm text-slate-600">{message.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <CommunicationsTab entityType="OFFICE" entityId="GLOBAL" />
    </div>
  );
}
