import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, IconButton, Input, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/shared/ui';
import type { BinderDetailBundle, BinderSimulationResult, BinderUsageSummary } from '../model/readModels';
import type { BinderTabKey } from './BinderTabs';
import { BinderTabs } from './BinderTabs';
import { BinderSummaryStrip } from './BinderSummaryStrip';
import { AuthorizedProductsPanel } from './AuthorizedProductsPanel';
import { deriveBinderDetailState } from '../model/binderDerivedState';
import type { SimulateBinderInput } from '../commands/simulateBinderCheck';

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{value || '—'}</div>
    </div>
  );
}

export function BinderDetailView({
  bundle,
  usage,
  activeTab,
  simulation,
  simulationLoading,
  onTabChange,
  onRefresh,
  onPublish,
  onSimulate,
}: {
  bundle: BinderDetailBundle;
  usage: BinderUsageSummary | null;
  activeTab: BinderTabKey;
  simulation: BinderSimulationResult | null;
  simulationLoading: boolean;
  onTabChange: (tab: BinderTabKey) => void;
  onRefresh: () => void;
  onPublish: () => void;
  onSimulate: (input: SimulateBinderInput) => void;
}) {
  const navigate = useNavigate();
  const derived = useMemo(() => deriveBinderDetailState(bundle), [bundle]);
  const [simulationForm, setSimulationForm] = useState<SimulateBinderInput>({
    territory: 'CY',
    riskLocationCountry: 'CY',
    insuredDomicileCountry: 'CY',
    vehicleValue: 25000,
  });

  const sectionTitle = (title: string) => (
    <div className="text-2xl font-black text-slate-900 tracking-tight">{title}</div>
  );

  const renderOverview = () => (
    <div className="space-y-8">
      <section className="space-y-4">
        {sectionTitle('Binder Summary')}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <KeyValue label="Coverholder name" value={bundle.binder.coverholderName} />
          <KeyValue label="Coverholder PIN" value={bundle.binder.coverholderPin || 'Not set'} />
          <KeyValue label="UMR" value={bundle.binder.umr} />
          <KeyValue label="Agreement number" value={bundle.binder.agreementNumber} />
          <KeyValue label="Status" value={bundle.binder.status} />
          <KeyValue label="Version" value={String(bundle.binder.version || 1)} />
        </div>
      </section>

      <section className="space-y-3">
        {sectionTitle('Config Health')}
        {derived.warnings.length === 0 ? (
          <div className="text-sm font-semibold text-emerald-700">Binder configuration is healthy.</div>
        ) : (
          derived.warnings.map((w) => (
            <div key={w} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">{w}</div>
          ))
        )}
      </section>

      <section className="space-y-3">
        {sectionTitle('Operational Readiness')}
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={derived.isUsableForAssignment ? 'Assignable' : 'Not assignable'} tone={derived.isUsableForAssignment ? 'success' : 'danger'} />
          <StatusPill label={derived.isUsableForBind ? 'Bindable' : 'Not bindable'} tone={derived.isUsableForBind ? 'success' : 'danger'} />
          <StatusPill label={derived.canSimulate ? 'Simulation ready' : 'Simulation unavailable'} tone={derived.canSimulate ? 'info' : 'warning'} />
        </div>
      </section>
    </div>
  );

  const renderAgreement = () => (
    <div className="space-y-8">
      <section className="space-y-4">
        {sectionTitle('Agreement Core')}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <KeyValue label="Agreement Number" value={bundle.binder.agreementNumber} />
          <KeyValue label="UMR" value={bundle.binder.umr} />
          <KeyValue label="Reporting Version" value={bundle.binder.lloydsReportingVer} />
          <KeyValue label="Default Currency" value={bundle.binder.defaultCurrency} />
          <KeyValue label="Settlement Currency" value={bundle.binder.settlementCurrency} />
          <KeyValue label="Effective Start" value={bundle.binder.startDate || 'Not set'} />
        </div>
      </section>

      <section className="space-y-4">
        {sectionTitle('Coverages')}
        {bundle.coverages.length === 0 ? <div className="text-sm font-semibold text-slate-500">No coverages extracted.</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coverage code</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Allowed</TableHead>
                <TableHead>Wording anchor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundle.coverages.map((coverage) => (
                <TableRow key={coverage.id}>
                  <TableCell>{coverage.coverageCode}</TableCell>
                  <TableCell>{coverage.title || '—'}</TableCell>
                  <TableCell>{coverage.allowed ? 'Yes' : 'No'}</TableCell>
                  <TableCell>{coverage.wordingAnchorClauseId || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-4">
        {sectionTitle('Clauses')}
        {bundle.clauses.length === 0 ? <div className="text-sm font-semibold text-slate-500">No clauses extracted.</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Text</TableHead>
                <TableHead>Codes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundle.clauses.map((clause) => (
                <TableRow key={clause.id}>
                  <TableCell>{clause.clauseType || 'Clause'}</TableCell>
                  <TableCell>{clause.textFragment || '—'}</TableCell>
                  <TableCell>{clause.codes.join(', ') || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );

  const renderAuthority = () => (
    <div className="space-y-8">
      <section className="space-y-4">
        <AuthorizedProductsPanel binderId={bundle.binder.id} />
      </section>
      <section className="space-y-4">
        {sectionTitle('Authority Summary (legacy config snapshot)')}
        <div className="text-xs text-slate-500 font-semibold">
          Read-only. Per-product authority lives above; this block is retained for migration visibility and will be retired once all binders are backfilled.
        </div>
        <pre className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 overflow-x-auto">
          {JSON.stringify((bundle.binder.config as Record<string, unknown>).authority || {}, null, 2)}
        </pre>
      </section>
      <section className="space-y-4">
        {sectionTitle('Simulation')}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Input placeholder="Territory" value={String(simulationForm.territory || '')} onChange={(e) => setSimulationForm((s) => ({ ...s, territory: e.target.value }))} />
          <Input placeholder="Risk location country" value={String(simulationForm.riskLocationCountry || '')} onChange={(e) => setSimulationForm((s) => ({ ...s, riskLocationCountry: e.target.value }))} />
          <Input placeholder="Insured domicile country" value={String(simulationForm.insuredDomicileCountry || '')} onChange={(e) => setSimulationForm((s) => ({ ...s, insuredDomicileCountry: e.target.value }))} />
          <Input placeholder="Vehicle value" value={String(simulationForm.vehicleValue || '')} onChange={(e) => setSimulationForm((s) => ({ ...s, vehicleValue: Number(e.target.value || 0) }))} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={() => onSimulate(simulationForm)} disabled={simulationLoading}>{simulationLoading ? 'Running...' : 'Run simulation'}</Button>
        </div>
        {simulation ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-semibold text-slate-800">Result: {simulation.pass ? 'PASS' : 'FAIL'}</div>
            <div className="text-xs text-slate-500 mt-1">Referral target: {simulation.referralTarget || 'None'}</div>
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
              {simulation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );

  const renderFinancialsReporting = () => (
    <div className="space-y-8">
      <section className="space-y-4">
        {sectionTitle('Financial Controls')}
        <pre className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 overflow-x-auto">
          {JSON.stringify(bundle.financials || {}, null, 2)}
        </pre>
      </section>
      <section className="space-y-4">
        {sectionTitle('Reporting')}
        <pre className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 overflow-x-auto">
          {JSON.stringify(bundle.reporting || {}, null, 2)}
        </pre>
      </section>
    </div>
  );

  const renderPartiesDocuments = () => (
    <div className="space-y-8">
      <section className="space-y-4">
        {sectionTitle('Parties')}
        {bundle.parties.length === 0 ? <div className="text-sm font-semibold text-slate-500">No parties found.</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Registration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundle.parties.map((party) => (
                <TableRow key={party.id}>
                  <TableCell>{party.name}</TableCell>
                  <TableCell>{party.role}</TableCell>
                  <TableCell>{party.registrationNumber || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-4">
        {sectionTitle('Documents')}
        {bundle.documents.length === 0 ? <div className="text-sm font-semibold text-slate-500">No documents found.</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Uploaded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundle.documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>{doc.name}</TableCell>
                  <TableCell>{doc.type}</TableCell>
                  <TableCell>{doc.uploadedAt || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );

  const renderUsage = () => (
    <div className="space-y-8">
      <section className="space-y-4">
        {sectionTitle('Program Links')}
        {!usage || usage.linkedPrograms.length === 0 ? (
          <div className="text-sm font-semibold text-slate-500">No linked programs.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Program</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Program Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.linkedPrograms.map((link) => (
                <TableRow key={link.id}>
                  <TableCell>{link.programName || link.programId}</TableCell>
                  <TableCell>{link.status}</TableCell>
                  <TableCell>{link.programStatus || '—'}</TableCell>
                  <TableCell>{link.updatedAt || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
        Policies cannot be assigned or bound unless binder is ACTIVE and Program↔Binder link is ACTIVE.
      </div>
    </div>
  );

  const tabBody = (() => {
    if (activeTab === 'agreement') return renderAgreement();
    if (activeTab === 'authority') return renderAuthority();
    if (activeTab === 'financials-reporting') return renderFinancialsReporting();
    if (activeTab === 'parties-documents') return renderPartiesDocuments();
    if (activeTab === 'usage') return renderUsage();
    return renderOverview();
  })();

  return (
    <div className="ui-page max-w-none space-y-10 pb-24">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 flex items-center gap-4">
            <IconButton title="Back" variant="neutral" onClick={() => navigate('/configure/binders')}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </IconButton>
            <h1 className="min-w-0 text-3xl font-black text-slate-900 tracking-tight truncate">
              {bundle.binder.coverholderName || bundle.binder.agreementNumber || 'Binder'}
            </h1>
            <span className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
              bundle.binder.status === 'ACTIVE' ? 'bg-emerald-100/70 text-emerald-900' : 'bg-slate-100 text-slate-700'
            }`}>
              {bundle.binder.status}
            </span>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Button variant="secondary" onClick={onRefresh}>Refresh</Button>
            <Button variant="secondary" onClick={onPublish} disabled={!derived.canPublish}>Publish</Button>
            <Button onClick={() => navigate(`/configure/binders/${encodeURIComponent(bundle.binder.id)}/edit`)}>Edit binder</Button>
          </div>
        </div>
      </section>
      <BinderSummaryStrip bundle={bundle} />
      <Card className="ui-card ui-card-flat bg-brand-canvas">
        <div className="px-0 bg-brand-canvas">
          <BinderTabs activeTab={activeTab} onChange={onTabChange} />
        </div>
        <div className="px-0 pt-4 pb-8 bg-brand-canvas min-h-workspace">
          {tabBody}
        </div>
      </Card>
    </div>
  );
}
