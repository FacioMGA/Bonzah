import OpenMarketQuoteWizard from './OpenMarketQuoteWizard';

export interface OpenMarketWizardRouteAdapterProps {
  policyId?: string;
}

export default function OpenMarketWizardRouteAdapter(props: OpenMarketWizardRouteAdapterProps) {
  return <OpenMarketQuoteWizard policyId={props.policyId} />;
}
