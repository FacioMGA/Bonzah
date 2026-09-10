import { useNavigate } from 'react-router-dom';
import type { BreadcrumbItem } from '@/src/shared/ui';

export const REPORTING_HUB_PATH = '/reporting';

export function useReportingBackBreadcrumb(): BreadcrumbItem {
  const navigate = useNavigate();
  return {
    label: 'Back to Reporting',
    onClick: () => navigate(REPORTING_HUB_PATH),
  };
}
