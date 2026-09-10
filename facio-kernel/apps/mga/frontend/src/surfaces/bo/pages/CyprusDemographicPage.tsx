import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import GenericOperationalReportPage from './reports/GenericOperationalReportPage';

export default function CyprusDemographicPage() {
  return (
    <GenericOperationalReportPage
      title="Cyprus Demographic"
      subtitle="Cyprus Home demographic report derived from policy proposer data."
      load={api.getCyprusDemographicReport}
      defaultProductType="HOME"
    />
  );
}
