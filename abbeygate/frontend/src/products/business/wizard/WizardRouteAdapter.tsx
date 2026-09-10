import BusinessQuoteWizard from './BusinessQuoteWizard';

export interface BusinessWizardRouteAdapterProps {
  policyId?: string;
}

export default function BusinessWizardRouteAdapter(props: BusinessWizardRouteAdapterProps) {
  return <BusinessQuoteWizard policyId={props.policyId ?? ''} />;
}
