import React from 'react';
import { Link, Navigate, Route, useParams } from 'react-router-dom';

import {
  QuotePage,
  EmailOtpVerifyPage,
  PublicFnolPage,
  ResetPasswordPage,
} from '@/src/surfaces/public/pages';
import { makeQuoteStartPage } from '@/src/surfaces/public/pages/GenericQuoteStartPage';
import { productCatalog, QUICK_START_ENTRIES, isProductAvailableInCountry } from '@/src/products/catalog';
import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';
import { useProductChannels, isProductOnlineEntryAllowed } from '@/src/shared/lib/productChannels';
import { BonzahDirectPage, SummitRentalDemoPage } from '@/src/products/rental';

function QuoteProductPickerPage() {
  const operatingCountry = getOperatingCountryFromHost();
  const { map: channelMap, isAdmin } = useProductChannels();
  const availableProducts = productCatalog.filter(
    (entry) =>
      isProductAvailableInCountry(entry, operatingCountry)
      // ADR-0046 — hide products whose online questionnaire is switched off
      // for this tenant (unless a logged-in admin is bypassing the gate).
      && isProductOnlineEntryAllowed(channelMap, entry.publicSessionSlug, isAdmin),
  );
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-canvas px-6">
      <div className="ui-card ui-card-pad max-w-xl w-full text-center">
        <div className="text-sm font-black text-slate-900">Choose a product to start your quote</div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {availableProducts.map((entry) => (
            <Link
              key={entry.publicEntryPath}
              to={entry.publicEntryPath}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {entry.manifest.theme.segmentLabel}
            </Link>
          ))}
          {QUICK_START_ENTRIES.map((entry) => (
            <Link
              key={entry.key}
              to={entry.path}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {entry.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientPublicDashboardRedirect() {
  const { policyId } = useParams();
  const token = String(policyId || '').trim();
  const query = new URLSearchParams({
    mode: 'signup',
    next: '/client',
    ...(token ? { claimToken: token } : {}),
  }).toString();
  return <Navigate to={`/login?${query}`} replace />;
}

type PublicSurfaceRoutesProps = {
  LoginEntry: React.ComponentType;
};

function sharedPublicRoutes(LoginEntry: React.ComponentType) {
  const operatingCountry = getOperatingCountryFromHost();
  return (
    <>
      <Route path="/login" element={<LoginEntry />} />
      <Route path="/verify-email" element={<EmailOtpVerifyPage />} />
      <Route path="/auth/reset" element={<ResetPasswordPage />} />

      <Route path="/get-auto-quote" element={<Navigate to="/quote/start" replace />} />
      <Route path="/quote" element={<QuoteProductPickerPage />} />
      <Route path="/quote/start" element={<QuoteProductPickerPage />} />
      {productCatalog.map((entry) => {
        // Products not offered in this jurisdiction (e.g. Health on PT/GR/ES)
        // bounce any direct/bookmarked link back to the picker rather than
        // letting a customer start a quote underwriting will only decline.
        if (!isProductAvailableInCountry(entry, operatingCountry)) {
          return <Route key={entry.publicEntryPath} path={entry.publicEntryPath} element={<Navigate to="/quote/start" replace />} />;
        }
        const QuoteStartPage = makeQuoteStartPage(entry.publicSessionSlug, entry.firstStep);
        return <Route key={entry.publicEntryPath} path={entry.publicEntryPath} element={<QuoteStartPage />} />;
      })}
      <Route path="/quote/:policyId" element={<QuotePage />} />
      <Route path="/bonzah" element={<BonzahDirectPage />} />
      <Route path="/bonzah/quote/*" element={<Navigate to="/bonzah" replace />} />
      <Route path="/summit-rentals" element={<SummitRentalDemoPage />} />

      <Route path="/client/public/:policyId" element={<ClientPublicDashboardRedirect />} />
      <Route
        path="/fnol/:token"
        element={(
          <div className="brand-route-scroll h-screen overflow-y-auto overflow-x-hidden">
            <PublicFnolPage />
          </div>
        )}
      />
    </>
  );
}

export function PublicSurfaceRoutes({ LoginEntry }: PublicSurfaceRoutesProps) {
  return sharedPublicRoutes(LoginEntry);
}

export function buildPublicSurfaceRouteElements({ LoginEntry }: PublicSurfaceRoutesProps) {
  return sharedPublicRoutes(LoginEntry);
}
