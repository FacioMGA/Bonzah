import RentalQuoteWizard from './RentalQuoteWizard';

export default function RentalWizardRouteAdapter({ policyId }: { policyId?: string }) {
  if (!policyId) return <div className="min-h-screen grid place-items-center text-slate-500">Starting your rental protection quote…</div>;
  return <RentalQuoteWizard policyId={policyId} />;
}
