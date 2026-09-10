import type { FacioCoverage } from './facioApi';

type Term = {
  id: string;
  label: string;
  basis: string;
  value: { kind: string; amount?: number; currency?: string; percent?: number };
};
/** Display only the terms emitted by Facio; never invent a limit or deductible. */
export function CoverageTerms({ coverage }: { coverage: FacioCoverage }) {
  const terms = coverage.benefitTerms as
    | { schemaVersion?: number; benefits?: Array<{ id: string; label: string; terms: Term[] }> }
    | undefined;
  if (coverage.termsMode !== 'structured')
    return (
      <p className="mt-2 text-sm">
        Published maximum limit: {coverage.maxLimit ?? 'Not specified'} · Minimum deductible:{' '}
        {coverage.minExcess ?? 'Not specified'}
      </p>
    );
  if (terms?.schemaVersion !== 1 || !Array.isArray(terms.benefits))
    return <p>Coverage terms are unavailable.</p>;
  return (
    <div className="mt-3 space-y-3">
      {terms.benefits.map((benefit) => (
        <div key={benefit.id}>
          <p className="text-sm font-semibold">{benefit.label}</p>
          {benefit.terms.map((term) => (
            <p key={term.id} className="text-xs text-slate-600">
              {term.label}:{' '}
              {term.value.kind === 'money' &&
              typeof term.value.amount === 'number' &&
              term.value.currency
                ? new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: term.value.currency,
                  }).format(term.value.amount)
                : term.value.kind === 'percentage'
                  ? `${term.value.percent}%`
                  : term.value.kind === 'none'
                    ? 'No deductible'
                    : 'Not specified'}{' '}
              · {term.basis.replaceAll('_', ' ')}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
