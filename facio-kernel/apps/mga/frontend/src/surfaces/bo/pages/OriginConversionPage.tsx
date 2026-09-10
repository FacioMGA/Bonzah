import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import GenericOperationalReportPage from './reports/GenericOperationalReportPage';

export default function OriginConversionPage() {
  return (
    <GenericOperationalReportPage
      title="Origin & Conversion"
      subtitle="Enquiries, origin and conversion rate by assigned staff member."
      load={api.getOriginConversionReport}
    />
  );
}
