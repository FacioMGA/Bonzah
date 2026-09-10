import TravelQuoteWizard from './TravelQuoteWizard';

export interface TravelWizardRouteAdapterProps {
  policyId?: string;
  productParam?: string;
}

export default function TravelWizardRouteAdapter(props: TravelWizardRouteAdapterProps) {
  if (!props.policyId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Starting your travel quote…
      </div>
    );
  }
  return <TravelQuoteWizard policyId={props.policyId} />;
}
