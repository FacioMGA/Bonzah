import React from 'react';
import { useSession } from '@/src/modules/auth/useSession';
import { WorkspaceOrganizationProfileView } from '@/src/modules/settings/views/WorkspaceOrganizationProfileView';

export default function OrganizationProfilePage() {
  const { user } = useSession();
  return <WorkspaceOrganizationProfileView accountId={user?.primaryAccountId ?? null} />;
}
