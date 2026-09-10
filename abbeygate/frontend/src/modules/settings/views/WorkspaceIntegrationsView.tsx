import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { settingsApiClient } from '../api/settingsApiClient';

type IntegrationStatus = 'connected' | 'not_connected' | 'status_unavailable';

type IntegrationCard = {
  id: string;
  name: string;
  status: IntegrationStatus;
  lastActivityAt: string | null;
};

type ActivityRow = {
  integration: string;
  endpoint: string;
  status: 'success' | 'fail';
  timestamp: string;
};

const INTEGRATION_REGISTRY: Array<{ id: string; name: string }> = [
  { id: 'cardcorp', name: 'CardCorp' },
  { id: 'datadog', name: 'DataDog' },
  { id: 'creditsafe', name: 'CreditSafe' },
];

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: 'Connected',
  not_connected: 'Not Connected',
  status_unavailable: 'Status unavailable',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStatus(value: unknown): IntegrationStatus {
  return value === 'connected' || value === 'not_connected' || value === 'status_unavailable'
    ? value
    : 'status_unavailable';
}

function asActivityRows(value: unknown): ActivityRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const integration = typeof record.integration === 'string' ? record.integration : '';
    const endpoint = typeof record.endpoint === 'string' ? record.endpoint : '';
    const status = record.status === 'success' || record.status === 'fail' ? record.status : null;
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : '';
    if (!integration || !endpoint || !status || !timestamp) return [];
    return [{ integration, endpoint, status, timestamp }];
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return 'No activity available yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No activity available yet' : date.toLocaleString();
}

export function WorkspaceIntegrationsView() {
  const [loading, setLoading] = React.useState(true);
  const [cards, setCards] = React.useState<IntegrationCard[]>([]);
  const [activity, setActivity] = React.useState<ActivityRow[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [statusRes, activityRes] = await Promise.all([
          settingsApiClient.getSettings('integration_statuses.v1').catch(() => null),
          settingsApiClient.getSettings('integration_activity.v1').catch(() => null),
        ]);

        if (cancelled) return;

        const statusData = statusRes && typeof statusRes === 'object' && 'success' in statusRes
          ? asRecord((statusRes as { data?: unknown }).data)
          : {};
        const activityData = activityRes && typeof activityRes === 'object' && 'success' in activityRes
          ? asRecord((activityRes as { data?: unknown }).data)
          : {};

        setCards(INTEGRATION_REGISTRY.map((integration) => {
          const statusRecord = asRecord(statusData[integration.id]);
          return {
            id: integration.id,
            name: integration.name,
            status: asStatus(statusRecord.status),
            lastActivityAt: typeof statusRecord.lastActivityAt === 'string' ? statusRecord.lastActivityAt : null,
          };
        }));
        setActivity(asActivityRows(activityData.items));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ui-page max-w-6xl space-y-8">
      <PageHeader
        title="Integrations"
        subtitle="Truthful visibility into integration connectivity and read-only activity across the workspace."
        status={{ label: 'Read-only control', tone: 'info' }}
      />

      <section className="ui-card ui-card-pad space-y-6">
        <div>
          <h2 className="text-lg font-black text-slate-900">Connected Integrations</h2>
          <p className="mt-1 text-sm text-slate-500">
            Status is shown only when a real backing signal exists. Unknown states remain explicitly unavailable.
          </p>
        </div>

        {loading ? (
          <div className="text-sm text-slate-400">Loading integration status...</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <article key={card.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-black text-slate-900">{card.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{STATUS_LABELS[card.status]}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${
                    card.status === 'connected'
                      ? 'bg-emerald-50 text-emerald-700'
                      : card.status === 'not_connected'
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-amber-50 text-amber-700'
                  }`}>
                    {STATUS_LABELS[card.status]}
                  </span>
                </div>

                <div className="mt-6 text-sm text-slate-500">
                  <div className="font-black uppercase tracking-widest text-[10px] text-slate-400">Last activity</div>
                  <div className="mt-2">{formatDateTime(card.lastActivityAt)}</div>
                </div>

                <button
                  type="button"
                  className="mt-6 text-sm font-bold text-brand-primary disabled:text-slate-400"
                  disabled
                >
                  View activity
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="ui-card ui-card-pad space-y-6">
        <div>
          <h2 className="text-lg font-black text-slate-900">Activity / Calls</h2>
          <p className="mt-1 text-sm text-slate-500">
            Light read-only activity log for configured integrations. No filtering or control changes in this phase.
          </p>
        </div>

        {loading ? (
          <div className="text-sm text-slate-400">Loading activity...</div>
        ) : activity.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-sm text-slate-500">
            No activity available yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Integration</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Endpoint / Action</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {activity.map((row, index) => (
                  <tr key={`${row.integration}-${row.endpoint}-${row.timestamp}-${index}`}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.integration}</td>
                    <td className="px-4 py-3 text-slate-600">{row.endpoint}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-widest ${
                        row.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(row.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
