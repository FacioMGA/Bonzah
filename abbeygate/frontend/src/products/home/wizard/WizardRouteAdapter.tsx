import HomeQuoteWizard from './HomeQuoteWizard';

export interface HomeWizardRouteAdapterProps {
  policyId?: string;
  productParam?: string;
}

export default function HomeWizardRouteAdapter(props: HomeWizardRouteAdapterProps) {
  if (!props.policyId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Starting your quote…
      </div>
    );
  }
  return <HomeQuoteWizard policyId={props.policyId} />;
}
