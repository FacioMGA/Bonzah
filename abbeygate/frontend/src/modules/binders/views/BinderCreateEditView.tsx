import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, PageHeader, SectionCard, Textarea } from '@/src/shared/ui';
import type { BinderDetailBundle } from '../model/readModels';

/**
 * BinderCreateEditView — surface for the basic binder columns plus a raw
 * `binder.config` JSON editor.
 *
 * NOTE on what this view DOES NOT edit
 * ====================================
 * Per `docs/architecture/contracts/canonical-ownership.md` (row "Binder /
 * program authority") and `docs/architecture/contracts/product-engine-authority.md`
 * the canonical owner of binder authority (per-product `maxAdvanceInceptionDays`,
 * `maxPolicyPeriodDays`, `territorialScope`, `authorityClasses`, etc.) is the
 * `BinderProductAuthority` table. It is edited via the per-product
 * "Authorized products" panel (`AuthorizedProductsPanel`) backed by
 * `GET/POST/PATCH /api/binders/:id/authorities`. Any second editor for the
 * same fields is forbidden by the canonical-ownership contract
 * ("Maintaining both metadata-backed AND table-backed versions of the same
 * authority rule on the same branch").
 *
 * Earlier revisions of this view rendered structured "Authority" and
 * "Financials and Documentation" sections that read and wrote
 * `binder.config.authority.*` / `binder.config.financials.*` JSON keys. That
 * shape was hardcoded for the legacy Cyprus Motor binder and crashed on
 * render for any binder seeded by `canonicalProgramBinderSeed.ts` (HOME-*,
 * TRAVEL-*, HEALTH-*) whose `config` is `{ productType, scope }` only —
 * Sentry `ABBEYGATE-REACT-6` (`Cannot read properties of undefined (reading
 * 'maxAdvanceInceptionDays')`). Removing the structured sections eliminates
 * the contract drift and the crash; per-product authority editing now flows
 * through the canonical Authorized Products panel.
 */

type FormState = {
  coverholderName: string;
  agreementNumber: string;
  status: string;
  startDate: string;
  endDate: string;
};

function toDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

const EMPTY_CONFIG_TEXT = '{}';

export function BinderCreateEditView({
  mode,
  initial,
  onSubmit,
  saving,
  error,
}: {
  mode: 'create' | 'edit';
  initial: BinderDetailBundle | null;
  onSubmit: (payload: {
    coverholderName: string;
    agreementNumber: string;
    status: string;
    startDate: string;
    endDate: string;
    config: Record<string, unknown>;
  }) => void;
  saving: boolean;
  error: string;
}) {
  const navigate = useNavigate();

  const seed = useMemo<{ form: FormState; configText: string }>(() => {
    if (initial) {
      const seedConfig = (initial.binder.config ?? {}) as Record<string, unknown>;
      return {
        form: {
          coverholderName: initial.binder.coverholderName,
          agreementNumber: initial.binder.agreementNumber,
          status: initial.binder.status,
          startDate: initial.binder.startDate ? toDateInput(initial.binder.startDate) : '',
          endDate: initial.binder.endDate ? toDateInput(initial.binder.endDate) : '',
        },
        configText: JSON.stringify(seedConfig, null, 2),
      };
    }
    return {
      form: {
        coverholderName: '',
        agreementNumber: '',
        status: 'DRAFT',
        startDate: '',
        endDate: '',
      },
      configText: EMPTY_CONFIG_TEXT,
    };
  }, [initial]);

  const [form, setForm] = useState<FormState>(seed.form);
  const [configText, setConfigText] = useState<string>(seed.configText);
  const [localError, setLocalError] = useState('');

  return (
    <div className="ui-page max-w-none space-y-6">
      <PageHeader
        breadcrumb={{ label: 'Back', onClick: () => navigate('/configure/binders') }}
        title={mode === 'create' ? 'Create Binder' : 'Edit Binder'}
        subtitle="Structured binder configuration for BO governance"
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/configure/binders')}>Cancel</Button>
            <Button
              onClick={() => {
                let parsedConfig: Record<string, unknown>;
                try {
                  const candidate = JSON.parse(configText);
                  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
                    throw new Error('Binder config must be a JSON object');
                  }
                  parsedConfig = candidate as Record<string, unknown>;
                } catch (parseError) {
                  setLocalError(parseError instanceof Error ? parseError.message : 'Invalid JSON config');
                  return;
                }
                setLocalError('');
                onSubmit({ ...form, config: parsedConfig });
              }}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      />

      {error || localError ? (
        <Card className="border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error || localError}
        </Card>
      ) : null}

      <SectionCard title="Core Agreement">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input value={form.coverholderName} onChange={(e) => setForm((s) => ({ ...s, coverholderName: e.target.value }))} placeholder="Coverholder name" />
          <Input value={form.agreementNumber} onChange={(e) => setForm((s) => ({ ...s, agreementNumber: e.target.value }))} placeholder="Agreement number" />
          <Input value={form.status} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value.toUpperCase() }))} placeholder="Status" />
          <Input type="date" value={form.startDate} onValueChange={(next) => setForm((s) => ({ ...s, startDate: next }))} />
          <Input type="date" value={form.endDate} onValueChange={(next) => setForm((s) => ({ ...s, endDate: next }))} />
        </div>
      </SectionCard>

      <SectionCard
        title="Binder Authority and Financials"
      >
        <div className="space-y-2 text-sm font-medium text-slate-600">
          <p>
            Per-product authority (max advance inception days, max policy period, territorial
            scope, authority classes) is edited from the binder detail&apos;s
            <span className="font-bold"> &ldquo;Authorized products&rdquo; tab</span>, which
            writes directly to the canonical <code>BinderProductAuthority</code> rows.
          </p>
          <p>
            Binder financials (GPI limit, commission, brokerage) are owned by the canonical
            financials store; edit them through the binder detail&apos;s
            <span className="font-bold"> Premium / Financials view</span>. Editing those values
            from this form would create a stale duplicate of the canonical authority.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Binder Config (JSON)">
        <Textarea
          rows={22}
          value={configText}
          onChange={(e) => {
            setConfigText(e.target.value);
            if (localError) setLocalError('');
          }}
          placeholder="{}"
        />
      </SectionCard>
    </div>
  );
}
