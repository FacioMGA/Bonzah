import '@/src/products/motor/wizard/styles.css';
import { Suspense, lazy, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

const MotorQuoteWizard = lazy(() => import('@/src/products/motor/wizard/QuoteWizardEngine'));
const HomeWizardRouteAdapter = lazy(() => import('@/src/products/home/wizard/WizardRouteAdapter'));
const TravelWizardRouteAdapter = lazy(() => import('@/src/products/travel/wizard/WizardRouteAdapter'));
const HealthWizardRouteAdapter = lazy(() => import('@/src/products/health/wizard/WizardRouteAdapter'));
const BusinessWizardRouteAdapter = lazy(() => import('@/src/products/business/wizard/WizardRouteAdapter'));
const OpenMarketWizardRouteAdapter = lazy(() => import('@/src/products/open-market/wizard/WizardRouteAdapter'));
const RentalWizardRouteAdapter = lazy(() => import('@/src/products/rental/WizardRouteAdapter'));

export default function QuotePage() {
  const { policyId } = useParams();
  const [searchParams] = useSearchParams();
  const productParam = (searchParams.get('product') || '').toLowerCase();
  const entryIntent = searchParams.get('intent') || '';

  useEffect(() => {
    const prevHtmlOverflowX = document.documentElement.style.overflowX;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyOverflowX = document.body.style.overflowX;
    const prevBodyHeight = document.body.style.height;
    const root = document.getElementById('root');
    const prevRootOverflow = root?.style.overflow;
    const prevRootOverflowX = root?.style.overflowX;
    const prevRootHeight = root?.style.height;

    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.overflowX = 'hidden';
    document.body.style.height = 'auto';
    if (root) {
      root.style.overflow = 'hidden';
      root.style.overflowX = 'hidden';
      root.style.height = 'auto';
    }

    return () => {
      document.documentElement.style.overflowX = prevHtmlOverflowX;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.overflowX = prevBodyOverflowX;
      document.body.style.height = prevBodyHeight;
      if (root) {
        root.style.overflow = prevRootOverflow || '';
        root.style.overflowX = prevRootOverflowX || '';
        root.style.height = prevRootHeight || '';
      }
    };
  }, []);

  const Adapter = useMemo(() => {
    if (productParam === 'home') return HomeWizardRouteAdapter;
    if (productParam === 'travel') return TravelWizardRouteAdapter;
    if (productParam === 'health') return HealthWizardRouteAdapter;
    if (productParam === 'business') return BusinessWizardRouteAdapter;
    if (productParam === 'open-market') return OpenMarketWizardRouteAdapter;
    if (productParam === 'motor') return MotorQuoteWizard;
    if (productParam === 'rental') return RentalWizardRouteAdapter;
    return null;
  }, [productParam]);

  return (
    <div className="brand-route-scroll h-screen overflow-y-auto overflow-x-hidden">
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>}>
        {Adapter ? (
          <Adapter policyId={policyId} entryIntent={entryIntent} />
        ) : (
          <div className="min-h-screen flex items-center justify-center text-slate-500">
            Product code is required to open a quote session.
          </div>
        )}
      </Suspense>
    </div>
  );
}
