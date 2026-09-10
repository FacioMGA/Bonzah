import HealthQuoteWizard from './HealthQuoteWizard';

export interface HealthWizardRouteAdapterProps {
  policyId?: string;
  productParam?: string;
}

export default function HealthWizardRouteAdapter(props: HealthWizardRouteAdapterProps) {
  if (!props.policyId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Starting your health quote…
      </div>
    );
  }
  return <HealthQuoteWizard policyId={props.policyId} />;
}
