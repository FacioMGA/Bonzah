import React from 'react';
import { Link } from 'react-router-dom';
import { productCatalog, QUICK_START_ENTRIES, isProductAvailableInCountry } from '../../../products/catalog';
import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';

const PRODUCT_BLURBS: Record<string, string> = {
  motor: 'Cars, bikes, classics and everyday vehicles.',
  home: 'Buildings, contents or both in one flow.',
  travel: 'Single trip or annual cover for your travel plans.',
  health: 'Immigration medical cover for Cyprus residency.',
  business: 'Commercial cover request for staff review.',
  'open-market': 'Manual market proposal assembled by staff.',
};

function productLabel(entry: (typeof productCatalog)[number]) {
  return entry.manifest.theme.segmentLabel || entry.manifest.displayName;
}

export function ClientQuoteEntryPanel() {
  const operatingCountry = getOperatingCountryFromHost();
  const availableProducts = productCatalog.filter((entry) => isProductAvailableInCountry(entry, operatingCountry));

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.22em] text-brand-primary">New quote</div>
          <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">Get covered in minutes</h2>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            Start a new quote, then come back here to review and manage it.
          </p>
        </div>

        <Link
          to="/quote/start"
          className="inline-flex h-12 items-center justify-center rounded-2xl bg-brand-primary px-6 text-sm font-black text-white shadow-sm transition hover:bg-brand-primary/90"
        >
          Get a quote
        </Link>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {availableProducts.map((entry) => (
          <Link
            key={entry.publicEntryPath}
            to={entry.publicEntryPath}
            className="group rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-0.5 hover:border-brand-primary/30 hover:bg-white hover:shadow-md"
          >
            <div className="text-sm font-black text-slate-950">{productLabel(entry)}</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
              {PRODUCT_BLURBS[entry.publicSessionSlug] || 'Start a new quote.'}
            </div>
            <div className="mt-3 text-xs font-black uppercase tracking-widest text-brand-primary">
              Start quote
            </div>
          </Link>
        ))}
        {QUICK_START_ENTRIES.map((entry) => (
          <Link
            key={entry.key}
            to={entry.path}
            className="group rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-0.5 hover:border-brand-primary/30 hover:bg-white hover:shadow-md"
          >
            <div className="text-sm font-black text-slate-950">{entry.label}</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">{entry.blurb}</div>
            <div className="mt-3 text-xs font-black uppercase tracking-widest text-brand-primary">
              Start quote
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
