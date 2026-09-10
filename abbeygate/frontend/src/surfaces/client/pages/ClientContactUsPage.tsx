import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';

const SUPPORT_EMAIL = 'support@facio.io';

export default function ClientContactUsPage() {
  const navigate = useNavigate();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <PageHeader
        breadcrumb={{ label: 'Back', onClick: () => navigate(-1) }}
        title="Contact us"
        subtitle="We’ll help you quickly and quietly."
        actions={(
          <Button variant="secondary" size="lg" onClick={() => navigate('/client')}>
            Home
          </Button>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 lg:col-span-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email</div>
          <div className="mt-2 text-xl font-black text-slate-900">{SUPPORT_EMAIL}</div>
          <div className="mt-2 text-sm font-semibold text-slate-600">
            If you’re contacting us about a claim, include your policy number (and claim number if you have one).
          </div>

          <div className="mt-6 flex items-center gap-3 flex-wrap">
            <a
              className="px-6 py-4 rounded-3xl bg-slate-900 text-white font-black shadow-lg shadow-slate-900/10"
              href={`mailto:${encodeURIComponent(SUPPORT_EMAIL)}?subject=${encodeURIComponent('FacioMGA support')}`}
            >
              Send email
            </a>
            <Button variant="secondary" size="lg" onClick={() => navigate('/client')}>
              Open policies
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tip</div>
          <div className="mt-2 text-sm font-semibold text-slate-700">
            For accidents, start with <span className="font-black">Report an Accident</span>. It captures the legally required FNOL form and attaches documents in one place.
          </div>
          <div className="mt-6">
            <Button size="lg" onClick={() => navigate('/client')}>
              Report an Accident
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
