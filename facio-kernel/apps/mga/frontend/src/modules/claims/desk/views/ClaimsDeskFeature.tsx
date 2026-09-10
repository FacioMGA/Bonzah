import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useClaimsDeskController } from '@/src/modules/claims/desk/controller/useClaimsDeskController';
import { ClaimsDeskWorkspaceView } from '@/src/modules/claims/desk/views/ClaimsDeskWorkspaceView';

export const ClaimsDeskFeature: React.FC = () => {
  const params = useParams<{ id?: string }>();
  const routeClaimId = String(params.id || '');
  const navigate = useNavigate();
  const location = useLocation();
  const ctrl = useClaimsDeskController({ routeClaimId });

  return <ClaimsDeskWorkspaceView ctrl={ctrl} location={location} navigate={navigate} />;
};
