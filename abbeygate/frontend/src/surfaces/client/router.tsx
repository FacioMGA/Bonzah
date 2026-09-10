import React from 'react';
import { Navigate, Route } from 'react-router-dom';

import {
  ClientBillingPage,
  ClientCancelPolicyPage,
  ClientClaimFormPage,
  ClientContactUsPage,
  ClientDashboardPage,
  ClientFnolInstructionsPage,
  ClientFnolPage,
  ClientPoliciesPage,
  ClientPolicyClaimViewPage,
  ClientPolicyDetailPage,
  ClientPolicyDocumentsPage,
  ClientPolicyDriversNewPage,
  ClientPolicyPaymentMethodPage,
  ClientProfilePage,
  ClientQuoteDetailPage,
  ClientQuotesPage,
} from '@/src/surfaces/client/pages';

type ClientSurfaceRoutesProps = {
  wrapProtected: (element: React.ReactElement) => React.ReactElement;
};

export function ClientSurfaceRoutes({ wrapProtected }: ClientSurfaceRoutesProps) {
  return (
    <>
      <Route path="/client" element={wrapProtected(<ClientDashboardPage />)} />
      <Route path="/client/quotes" element={wrapProtected(<ClientQuotesPage />)} />
      <Route path="/client/quotes/:id" element={wrapProtected(<ClientQuoteDetailPage />)} />
      <Route path="/client/policies" element={wrapProtected(<ClientPoliciesPage />)} />
      <Route path="/client/policies/:id" element={wrapProtected(<ClientPolicyDetailPage />)} />
      <Route path="/client/documents" element={<Navigate to="/client/policies" replace />} />
      <Route path="/client/billing" element={wrapProtected(<ClientBillingPage />)} />
      <Route path="/client/claims" element={<Navigate to="/client" replace />} />
      <Route path="/client/claims/fnol" element={<Navigate to="/client" replace />} />
      <Route path="/client/policy/:policyId/claim/new" element={wrapProtected(<ClientFnolPage />)} />
      <Route
        path="/client/policy/:policyId/claim/:claimId/fnol-instructions"
        element={wrapProtected(<ClientFnolInstructionsPage />)}
      />
      <Route path="/client/policy/:policyId/claim/:claimId" element={wrapProtected(<ClientPolicyClaimViewPage />)} />
      <Route path="/client/policy/:policyId/claim/:claimId/form" element={wrapProtected(<ClientClaimFormPage />)} />
      <Route path="/client/policy/:policyId/documents" element={wrapProtected(<ClientPolicyDocumentsPage />)} />
      <Route path="/client/policy/:policyId/drivers/new" element={wrapProtected(<ClientPolicyDriversNewPage />)} />
      <Route path="/client/policy/:policyId/payment-method" element={wrapProtected(<ClientPolicyPaymentMethodPage />)} />
      <Route path="/client/policy/:policyId/cancel" element={wrapProtected(<ClientCancelPolicyPage />)} />
      <Route path="/client/contact" element={wrapProtected(<ClientContactUsPage />)} />
      <Route path="/client/cancel-policy" element={wrapProtected(<ClientCancelPolicyPage />)} />
      <Route path="/client/profile" element={<Navigate to="/client/account" replace />} />
      <Route path="/client/account" element={wrapProtected(<ClientProfilePage />)} />
    </>
  );
}

export function buildClientSurfaceRouteElements({ wrapProtected }: ClientSurfaceRoutesProps) {
  return (
    <>
      <Route path="/client" element={wrapProtected(<ClientDashboardPage />)} />
      <Route path="/client/quotes" element={wrapProtected(<ClientQuotesPage />)} />
      <Route path="/client/quotes/:id" element={wrapProtected(<ClientQuoteDetailPage />)} />
      <Route path="/client/policies" element={wrapProtected(<ClientPoliciesPage />)} />
      <Route path="/client/policies/:id" element={wrapProtected(<ClientPolicyDetailPage />)} />
      <Route path="/client/documents" element={<Navigate to="/client/policies" replace />} />
      <Route path="/client/billing" element={wrapProtected(<ClientBillingPage />)} />
      <Route path="/client/claims" element={<Navigate to="/client" replace />} />
      <Route path="/client/claims/fnol" element={<Navigate to="/client" replace />} />
      <Route path="/client/policy/:policyId/claim/new" element={wrapProtected(<ClientFnolPage />)} />
      <Route
        path="/client/policy/:policyId/claim/:claimId/fnol-instructions"
        element={wrapProtected(<ClientFnolInstructionsPage />)}
      />
      <Route path="/client/policy/:policyId/claim/:claimId" element={wrapProtected(<ClientPolicyClaimViewPage />)} />
      <Route path="/client/policy/:policyId/claim/:claimId/form" element={wrapProtected(<ClientClaimFormPage />)} />
      <Route path="/client/policy/:policyId/documents" element={wrapProtected(<ClientPolicyDocumentsPage />)} />
      <Route path="/client/policy/:policyId/drivers/new" element={wrapProtected(<ClientPolicyDriversNewPage />)} />
      <Route path="/client/policy/:policyId/payment-method" element={wrapProtected(<ClientPolicyPaymentMethodPage />)} />
      <Route path="/client/policy/:policyId/cancel" element={wrapProtected(<ClientCancelPolicyPage />)} />
      <Route path="/client/contact" element={wrapProtected(<ClientContactUsPage />)} />
      <Route path="/client/cancel-policy" element={wrapProtected(<ClientCancelPolicyPage />)} />
      <Route path="/client/profile" element={<Navigate to="/client/account" replace />} />
      <Route path="/client/account" element={wrapProtected(<ClientProfilePage />)} />
    </>
  );
}
