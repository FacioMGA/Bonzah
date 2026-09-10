import React, { useState, useEffect } from 'react';
import { Button } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { formatDateUI } from '@/src/shared/lib/format';
import type { Program } from '@/src/modules/programs/model/programs';

import { ProgramAuthority } from '@/src/surfaces/bo/components/programs/ProgramAuthority';
import { ProgramTiming } from '@/src/surfaces/bo/components/programs/ProgramTiming';
import { ProgramEligibility } from '@/src/surfaces/bo/components/programs/ProgramEligibility';
import { ProgramCoverage } from '@/src/surfaces/bo/components/programs/ProgramCoverage';
import { ProgramUnderwriting } from '@/src/surfaces/bo/components/programs/ProgramUnderwriting';
import { ProgramPricing } from '@/src/surfaces/bo/components/programs/ProgramPricing';
import { CreateProgramModal } from '@/src/surfaces/bo/components/programs/CreateProgramModal';

import { logger } from '@/src/shared/lib/logger';

type ProgramMetadata = NonNullable<Program['metadata']>;
type ApiProgram = Omit<Program, 'metadata'> & { metadata?: ProgramMetadata };

const PageHeader = ({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) => (
  <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
    <div>
      <h1 className="text-3xl font-black text-slate-900 tracking-tight">{title}</h1>
      {subtitle && <p className="text-slate-500 font-medium mt-1">{subtitle}</p>}
    </div>
    {action && <div>{action}</div>}
  </header>
);

const ProgramsPage: React.FC = () => {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('Policy & Authority');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<Partial<Program>>({});

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) setSelectedId(hash);
  }, []);

  useEffect(() => {
    if (selectedId) window.location.hash = selectedId;
    else window.location.hash = '';
  }, [selectedId]);

  const fetchPrograms = async () => {
    try {
      setLoading(true);
      const resp = await api.listPrograms();
      if (resp?.success) {
        const mapped: Program[] = ((resp.data || []) as ApiProgram[]).map((p) => ({
          ...p,
          binder: '—',
          pricingModel: p.metadata?.pricingModel || 'Hybrid',
          cadence: p.metadata?.cadence || 'Monthly',
          currency: p.metadata?.currency || p.currency || 'EUR',
          validation: p.metadata?.validation || { exceptionQueue: 'Auto-create exceptions' },
          endorsements: p.metadata?.endorsements || { requireReason: true, requireEffectiveDate: true },
          pricing: p.metadata?.pricing || { rate: 0, notes: '' },
          versions: p.versions || [],
          metadata: p.metadata || {},
        })) as Program[];
        setPrograms(mapped);
      }
    } catch (e) {
      logger.error('Failed to load programs', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPrograms();
  }, []);

  const selected = programs.find((p) => p.id === selectedId);

  const handleChildUpdate = (updates: Partial<Program>) => {
    setPendingUpdates((prev) => ({ ...prev, ...updates }));
  };

  const saveChanges = async () => {
    if (!selected) return;
    try {
      const payload: Program = { ...selected, ...pendingUpdates };
      const metadata = {
        ...selected.metadata,
        pricingModel: payload.pricingModel,
        cadence: payload.cadence,
        currency: payload.currency,
        validation: payload.validation,
        endorsements: payload.endorsements,
        pricing: payload.pricing,
      };

      await api.updateProgram(selected.id, {
        name: payload.name,
        currency: payload.currency,
        metadata,
      });

      await fetchPrograms();
      setIsEditing(false);
      setPendingUpdates({});
      alert('Program updated successfully');
    } catch (e) {
      logger.error(e);
      alert('Failed to save changes');
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setPendingUpdates({});
  };

  const displayProgram = selected ? { ...selected, ...pendingUpdates } : null;

  if (selected && displayProgram) {
    return (
      <div className="ui-page max-w-7xl mx-auto space-y-10">
        <PageHeader
          title={displayProgram.name}
          subtitle={`${displayProgram.id} • ${displayProgram.status}`}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setSelectedId(null)}>Back to list</Button>
              {['Policy & Authority', 'Policy Timing & Earning', 'Eligibility & Inputs'].includes(activeTab) && (
                isEditing ? (
                  <>
                    <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
                    <Button onClick={saveChanges}>Save Changes</Button>
                  </>
                ) : (
                  <Button onClick={() => setIsEditing(true)}>Edit Program</Button>
                )
              )}
            </div>
          }
        />

        <div className="ui-tabsbar">
          {[
            'Policy & Authority',
            'Policy Timing & Earning',
            'Eligibility & Inputs',
            'Coverage & Wording',
            'Underwriting Rules',
            'Pricing & Financials',
          ].map((t) => (
            <Button
              key={t}
              type="button"
              variant="tab"
              size="tab"
              onClick={() => { setActiveTab(t); setIsEditing(false); setPendingUpdates({}); }}
              className={`ui-tab ${activeTab === t ? 'ui-tab-active' : 'ui-tab-inactive'}`}
            >
              {t}
            </Button>
          ))}
        </div>

        {activeTab === 'Policy & Authority' && (
          <ProgramAuthority program={displayProgram} isEditing={isEditing} onUpdate={handleChildUpdate} />
        )}
        {activeTab === 'Policy Timing & Earning' && (
          <ProgramTiming program={displayProgram} isEditing={isEditing} onUpdate={handleChildUpdate} />
        )}
        {activeTab === 'Eligibility & Inputs' && (
          <ProgramEligibility program={displayProgram} isEditing={isEditing} onUpdate={handleChildUpdate} />
        )}
        {activeTab === 'Coverage & Wording' && (
          <ProgramCoverage program={selected} />
        )}
        {activeTab === 'Underwriting Rules' && (
          <ProgramUnderwriting program={selected} />
        )}
        {activeTab === 'Pricing & Financials' && (
          <ProgramPricing program={selected} />
        )}
      </div>
    );
  }

  return (
    <div className="ui-page">
      <PageHeader
        title="Programs"
        subtitle="Manage insurance schemes, rating models, and underwriting rules."
        action={<Button onClick={() => setShowCreateModal(true)}>New Program</Button>}
      />

      {loading ? (
        <div className="ui-loading">Loading programs...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {programs.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className="ui-card p-6 cursor-pointer hover:border-brand-primary/30 transition group"
            >
              <div className="flex justify-between items-start">
                <div className="font-black text-slate-900 text-lg group-hover:text-brand-primary transition">
                  {p.name}
                </div>
                <span className={`ui-badge ${p.status === 'ACTIVE' ? 'ui-badge-success' : 'ui-badge-neutral'}`}>
                  {p.status}
                </span>
              </div>
              <div className="mt-4 space-y-2 text-sm text-slate-600 font-medium">
                <div className="flex justify-between">
                  <span>Currency</span>
                  <span className="font-bold text-slate-800">{p.currency || 'EUR'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pricing</span>
                  <span className="font-bold text-slate-800">{p.pricingModel}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last Updated</span>
                  <span className="font-bold text-slate-800">{p.versions?.[0]?.updatedAt ? formatDateUI(p.versions[0].updatedAt) : 'Never'}</span>
                </div>
              </div>
            </div>
          ))}

          {programs.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500 font-medium bg-slate-50 rounded-3xl border border-dashed border-slate-300">
              No programs found. Create one to get started.
            </div>
          )}
        </div>
      )}

      {showCreateModal && (
        <CreateProgramModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(newProgram) => {
            setPrograms(prev => [...prev, newProgram]);
            setSelectedId(newProgram.id);
          }}
        />
      )}
    </div>
  );
};

export default ProgramsPage;
