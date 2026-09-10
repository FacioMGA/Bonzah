import React from 'react';
import { settingsApiClient } from '@/src/modules/settings/api/settingsApiClient';
import { productCatalog } from '@/src/products/catalog';

/**
 * Back Office screen for the per-product public journey switches (ADR-0046):
 * Questions (open/fill the wizard), Quote (see a price), Payment (pay online).
 *
 * Scope is the active operating tenant (country). The backend enforces these
 * gates server-side and reads them fresh per request, so a save here takes
 * effect immediately on the public site.
 */

type Channel = { questions: boolean; quote: boolean; payment: boolean };
type ChannelMap = Record<string, Channel>;
type GateKey = keyof Channel;

const GATES: Array<{ key: GateKey; label: string; hint: string }> = [
  { key: 'questions', label: 'Questions', hint: 'Customer can open and fill the quote form' },
  { key: 'quote', label: 'Quote', hint: 'Customer can see a price' },
  { key: 'payment', label: 'Payment', hint: 'Customer can pay online' },
];

const PRODUCTS = productCatalog.map((entry) => ({
  code: String(entry.manifest.productType || '').toUpperCase(),
  label: entry.manifest.displayName,
}));

export function ProductChannelTogglesView() {
  const [channels, setChannels] = React.useState<ChannelMap>({});
  const [loading, setLoading] = React.useState(true);
  const [savingCode, setSavingCode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await settingsApiClient.getProductChannels().catch(() => null);
      if (cancelled) return;
      if (res && res.success && res.data) {
        setChannels(res.data as ChannelMap);
      } else {
        setError('Failed to load product channels.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = React.useCallback(async (code: string, gate: GateKey) => {
    const current = channels[code] || { questions: true, quote: true, payment: false };
    const next: Channel = { ...current, [gate]: !current[gate] };
    setChannels((prev) => ({ ...prev, [code]: next }));
    setSavingCode(code);
    setError(null);
    const res = await settingsApiClient.updateProductChannel(code, next).catch(() => null);
    setSavingCode(null);
    if (!res || !res.success) {
      setError(`Failed to save ${code}.`);
      setChannels((prev) => ({ ...prev, [code]: current }));
      return;
    }
    if (res.data) setChannels(res.data as ChannelMap);
  }, [channels]);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Product Channels</h1>
        <p className="text-sm text-slate-500 mt-1">
          Control which stages of the online journey are available to customers for each product on this
          site. Turning a switch off routes customers to a referral instead. Logged-in staff always bypass
          these switches.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="ui-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-3 font-semibold text-slate-700">Product</th>
              {GATES.map((g) => (
                <th key={g.key} className="px-4 py-3 font-semibold text-slate-700 text-center" title={g.hint}>
                  {g.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={GATES.length + 1}>Loading…</td></tr>
            ) : (
              PRODUCTS.map(({ code, label }) => {
                const channel = channels[code] || { questions: true, quote: true, payment: false };
                return (
                  <tr key={code} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{label}</div>
                      <div className="text-xs text-slate-400">{code}</div>
                    </td>
                    {GATES.map((g) => (
                      <td key={g.key} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-brand-primary"
                          checked={Boolean(channel[g.key])}
                          disabled={savingCode === code}
                          onChange={() => { void toggle(code, g.key); }}
                          aria-label={`${label} ${g.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProductChannelTogglesView;
