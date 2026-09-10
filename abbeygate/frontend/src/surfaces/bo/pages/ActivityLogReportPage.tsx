import { Navigate } from 'react-router-dom';
import { hasPermission } from '@/src/modules/auth/session';
import { useSession } from '@/src/modules/auth/useSession';
import AuditOperationalReportPage from './reports/AuditOperationalReportPage';

export default function ActivityLogReportPage() {
  const { user } = useSession();
  if (!hasPermission(user, 'people.activity.view')) {
    return <Navigate to="/reporting" replace />;
  }
  return <AuditOperationalReportPage kind="activity-log" />;
}
