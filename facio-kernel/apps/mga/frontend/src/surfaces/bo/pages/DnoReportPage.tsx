import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import GenericOperationalReportPage from './reports/GenericOperationalReportPage';

export default function DnoReportPage() {
  return (
    <GenericOperationalReportPage
      title="DNO Report"
      subtitle="Policies declined by online or back-office status. DNO definition can be tightened once Peter confirms the legacy criteria."
      load={api.getDnoReport}
    />
  );
}
