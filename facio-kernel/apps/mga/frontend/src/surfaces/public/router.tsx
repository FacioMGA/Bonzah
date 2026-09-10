import React from 'react';
import {RegisteredProductGate,useRegisteredProducts} from './pages/RegisteredProductGate';
import {Button} from '@/src/shared/ui';
import { Link, Navigate, Route, useLocation, useParams } from 'react-router-dom';

import {
  QuotePage,
  EmailOtpVerifyPage,
  PublicFnolPage,
  ResetPasswordPage,
} from '@/src/surfaces/public/pages';
import { makeQuoteStartPage } from '@/src/surfaces/public/pages/GenericQuoteStartPage';
import { productCatalog, QUICK_START_ENTRIES, isProductAvailableInCountry } from '@/src/products/catalog';
import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';

function QuoteProductPickerPage() {
  const operatingCountry = getOperatingCountryFromHost();
  const registered=useRegisteredProducts();
  const availableProducts = productCatalog.filter(
    (entry) => registered.products?.includes(entry.manifest.productType) && entry.publicJourneyAvailable !== false && isProductAvailableInCountry(entry, operatingCountry),
  );
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-canvas px-6">
      <div className="ui-card ui-card-pad max-w-xl w-full text-center">
        <div className="text-sm font-black text-slate-900">Choose a product to start your quote</div>
        {registered.error ? <div className="mt-4"><p role="alert">{registered.error}</p><Button type="button" onClick={registered.retry}>Retry programme lookup</Button></div> : registered.products === null ? <p role="status" className="mt-4">Loading registered programmes…</p> : availableProducts.length === 0 ? <p className="mt-4">No active programme currently offers a customer wizard in this workspace. Review the back-office programme settings.</p> : null}
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
          {QUICK_START_ENTRIES.filter((quickStart) => availableProducts.some((product) => product.publicSessionSlug === quickStart.productSessionSlug)).map((entry) => (
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

export function legacyRentalEntryLocation(search: string) {
  return { pathname: '/quote/rental-car/new', search };
}

function LegacyRentalEntryRedirect() {
  const { search } = useLocation();
  return <Navigate to={legacyRentalEntryLocation(search)} replace />;
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
      <Route path="/quote/rental/new" element={<LegacyRentalEntryRedirect />} />
      {productCatalog.filter(entry => entry.publicJourneyAvailable !== false).map((entry) => {
        // Products not offered in this jurisdiction (e.g. Health on PT/GR/ES)
        // bounce any direct/bookmarked link back to the picker rather than
        // letting a customer start a quote underwriting will only decline.
        if (!isProductAvailableInCountry(entry, operatingCountry)) {
          return <Route key={entry.publicEntryPath} path={entry.publicEntryPath} element={<Navigate to="/quote/start" replace />} />;
        }
        const QuoteStartPage = makeQuoteStartPage(entry.publicSessionSlug, entry.firstStep);
        return <Route key={entry.publicEntryPath} path={entry.publicEntryPath} element={<RegisteredProductGate productType={entry.manifest.productType}><QuoteStartPage /></RegisteredProductGate>} />;
      })}
      <Route path="/quote/:policyId" element={<QuotePage />} />

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
