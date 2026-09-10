import { Link } from 'react-router-dom';
import { PageHeader } from '@/src/shared/ui';

export default function ClaimsEntryPage() {
  return (
    <div className="ui-page max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Claims"
        subtitle="Open the Claims Desk to handle FNOL, worksheets, and Portugal statutory deadlines."
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Claims</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link to="/claims/desk" className="rounded-xl border border-slate-200 bg-slate-50 p-4 font-black text-slate-800 hover:border-brand-primary">
            Claims Desk
          </Link>
          <Link to="/claims/desk" className="rounded-xl border border-slate-200 bg-slate-50 p-4 font-black text-slate-800 hover:border-brand-primary">
            Deadlines / statutory timetable
          </Link>
        </div>
      </div>
    </div>
  );
}
