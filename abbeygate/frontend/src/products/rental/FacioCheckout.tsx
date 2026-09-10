import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button, Checkbox, Input } from '@/src/shared/ui';
import { ConfiguredField, collectionErrors, unsupportedField } from './ConfiguredField';
import { CoverageTerms } from './CoverageTerms';
import {
  downloadFacioDocument,
  facioRequest,
  readAnswer,
  writeAnswer,
  type FacioIntake,
  type FacioQuote,
  type FacioPolicy,
  type FacioReview,
} from './facioApi';

type Props = {
  channel: 'DIRECT' | 'DISTRIBUTION';
  prefill: Record<string, unknown>;
  onBack: () => void;
};
const money = (amount: number | undefined, currency: string | undefined) =>
  typeof amount === 'number' && currency
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    : 'Not yet quoted';

/** Renders the published Facio form; no insurance rates or eligibility rules live here. */
export function FacioCheckout({ channel, prefill, onBack }: Props) {
  const [intake, setIntake] = useState<FacioIntake>();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<FacioQuote>();
  const [policy, setPolicy] = useState<FacioPolicy>();
  const [review, setReview] = useState<FacioReview>();
  const [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const operation = useRef<{ payload: string; key: string } | undefined>(undefined);
  const initialPrefill = useRef(prefill);
  useEffect(() => {
    let active = true;
    setError('');
    void facioRequest<{ intake: FacioIntake }>(`/api/quote?channel=${channel}`)
      .then(({ intake: next }) => {
        if (!active) return;
        if (
          !next?.questionnaire?.sections ||
          !Array.isArray(next.coverageOptions) ||
          !Array.isArray(next.coverageAnswerPath)
        )
          throw new Error('The published rental form is incomplete.');
        let value = structuredClone(next.initialQuoteData);
        for (const field of next.questionnaire.sections.flatMap((section) => section.questions)) {
          if (
            !field.readOnly &&
            Object.prototype.hasOwnProperty.call(initialPrefill.current, field.key)
          )
            value = writeAnswer(value, field.answerPath, initialPrefill.current[field.key]);
        }
        setIntake(next);
        setAnswers(value);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [attempt, channel]);
  const change = (path: string[], value: unknown) => {
    setAnswers((current) => {
      let next = writeAnswer(current, path, value);
      for (const field of intake?.questionnaire.sections.flatMap((section) => section.questions) ??
        []) {
        if (
          !field.exactTime ||
          JSON.stringify(field.exactTime.dateAnswerPath) !== JSON.stringify(path)
        )
          continue;
        const retained = readAnswer(current, field.answerPath);
        if (
          typeof retained === 'string' &&
          /^\d{4}-\d{2}-\d{2}T/.test(retained) &&
          typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(value)
        )
          next = writeAnswer(next, field.answerPath, value + retained.slice(10));
      }
      return next;
    });
    setQuote(undefined);
    setReview(undefined);
    setConfirmed(false);
    operation.current = undefined;
  };
  const unsupported = intake?.questionnaire.sections
    .flatMap((section) => section.questions)
    .filter((field) => field.key !== intake.coverageQuestionKey && unsupportedField(field));
  const selectedRaw = intake ? readAnswer(answers, intake.coverageAnswerPath) : [];
  const selected = Array.isArray(selectedRaw)
    ? (selectedRaw as Array<{ coverage: string; limit?: number; excess?: number }>)
    : [];
  const chooseCoverage = (id: string, checked: boolean) => {
    if (!intake) return;
    const next = checked
      ? [...selected, { coverage: id }]
      : selected.filter((item) => item.coverage !== id);
    change(intake.coverageAnswerPath, next);
  };
  async function getQuote(event: FormEvent) {
    event.preventDefault();
    const errors = collectionErrors(
      intake?.questionnaire.sections.flatMap((section) => section.questions) ?? [],
      answers,
    );
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    setBusy(true);
    setError('');
    const body = { channel, quoteData: answers };
    const payload = JSON.stringify(body);
    if (!operation.current || operation.current.payload !== payload)
      operation.current = { payload, key: crypto.randomUUID() };
    try {
      setReview(undefined);
      setConfirmed(false);
      setQuote(await facioRequest<FacioQuote>('/api/quote', body, operation.current.key));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The quote was not confirmed.');
    } finally {
      setBusy(false);
    }
  }
  async function reviewQuote() {
    if (!quote?.receipt) return;
    setBusy(true);
    setError('');
    try {
      setReview(
        await facioRequest<FacioReview>(
          '/api/bind',
          { action: 'review', receipt: quote.receipt },
          `review-${quote.quoteId}`,
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Offer review was not confirmed.');
    } finally {
      setBusy(false);
    }
  }
  async function bind() {
    if (!quote || !review || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      setPolicy(
        await facioRequest<FacioPolicy>(
          '/api/bind',
          { action: 'complete', receipt: review.receipt, confirmed: true },
          `bind-${quote.quoteId}`,
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Policy completion was not confirmed.');
    } finally {
      setBusy(false);
    }
  }
  async function refreshPolicy() {
    if (!policy) return;
    setBusy(true);
    setError('');
    try {
      setPolicy(
        await facioRequest<FacioPolicy>(
          '/api/bind',
          { action: 'status', receipt: policy.receipt },
          `status-${policy.policyId}`,
        ),
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Policy status could not be refreshed.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function downloadDocument(id: string, filename: string) {
    if (!policy) return;
    setBusy(true);
    setError('');
    try {
      await downloadFacioDocument(policy.receipt, id, filename);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The document could not be downloaded.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-4xl space-y-6 rounded-3xl bg-white p-6 text-slate-900 shadow-sm sm:p-10">
      <Button variant="link" onClick={onBack} disabled={busy}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to rental
      </Button>
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-pink-700">
          {channel === 'DIRECT' ? 'Bonzah' : 'Summit Rentals'} · Powered by Facio
        </p>
        <h1 className="mt-2 text-3xl font-black">{intake?.title || 'Rental protection'}</h1>
        <p className="mt-2 text-slate-600">
          {channel === 'DIRECT'
            ? 'Review your details, get a live quote, then complete the demonstration policy.'
            : 'Get a live protection quote retained in the Bonzah workspace.'}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Synthetic demonstration. No real insurance cover or money collection.
        </p>
      </div>
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
          {error}
        </div>
      )}
      {!intake &&
        (error ? (
          <Button onClick={() => setAttempt((count) => count + 1)}>Retry connection</Button>
        ) : (
          <p role="status">Loading the published Facio form…</p>
        ))}
      {intake && !policy && (
        <form onSubmit={getQuote} className="space-y-7">
          {intake.questionnaire.sections.map((section) => {
            const fields = section.questions.filter(
              (field) => field.key !== intake.coverageQuestionKey && field.type !== 'hidden',
            );
            return (
              fields.length > 0 && (
                <fieldset key={section.id} className="space-y-4">
                  <legend className="mb-4 text-lg font-bold">{section.title}</legend>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {fields.map((field) => (
                      <ConfiguredField
                        key={field.key}
                        field={field}
                        answers={answers}
                        disabled={busy || Boolean(policy)}
                        onChange={change}
                      />
                    ))}
                  </div>
                </fieldset>
              )
            );
          })}
          {Boolean(unsupported?.length) && (
            <p role="alert">
              This published form contains fields requiring operator assistance:{' '}
              {unsupported?.map((field) => field.label).join(', ')}.
            </p>
          )}
          <fieldset className="space-y-3">
            <legend className="mb-3 text-lg font-bold">Choose protection</legend>
            {intake.coverageOptions.map((coverage) => (
              <div key={coverage.coverage} className="rounded-xl border border-slate-200 p-4">
                <Checkbox
                  label={coverage.label}
                  checked={selected.some((item) => item.coverage === coverage.coverage)}
                  disabled={busy || !coverage.selectable}
                  onChange={(event) => chooseCoverage(coverage.coverage, event.target.checked)}
                />
                <p className="mt-2 text-sm text-slate-600">
                  {coverage.description || coverage.unavailableReason}
                </p>
                {coverage.requires.length > 0 && (
                  <p className="mt-1 text-xs">
                    Requires:{' '}
                    {coverage.requires
                      .map(
                        (id) =>
                          intake.coverageOptions.find((item) => item.coverage === id)?.label || id,
                      )
                      .join(', ')}
                  </p>
                )}
                <CoverageTerms coverage={coverage} />
                {coverage.termsMode !== 'structured' && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {(['limit', 'excess'] as const).map((name) => (
                      <label key={name} className="text-sm">
                        {name === 'limit' ? 'Limit' : 'Deductible'}
                        <Input
                          aria-label={`${coverage.label} ${name}`}
                          type="number"
                          min={0}
                          value={
                            selected.find((item) => item.coverage === coverage.coverage)?.[name] ??
                            ''
                          }
                          disabled={
                            busy || !selected.some((item) => item.coverage === coverage.coverage)
                          }
                          onChange={(event) =>
                            change(
                              intake.coverageAnswerPath,
                              selected.map((item) =>
                                item.coverage === coverage.coverage
                                  ? {
                                      ...item,
                                      [name]:
                                        event.target.value === ''
                                          ? undefined
                                          : Number(event.target.value),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </fieldset>
          <Button
            type="submit"
            disabled={busy || Boolean(unsupported?.length)}
            className="w-full bg-pink-700 py-4 text-white"
          >
            {busy ? 'Contacting Facio…' : 'Get my quote'}
          </Button>
        </form>
      )}
      {quote && (
        <div className="space-y-3 rounded-2xl border border-slate-200 p-5" aria-live="polite">
          <div className="flex items-center gap-2">
            <ShieldCheck />
            <h2 className="text-xl font-bold">
              {quote.status === 'QUOTED'
                ? 'Quote retained in Facio'
                : quote.status === 'REFERRAL'
                  ? 'Underwriter review required'
                  : quote.status}
            </h2>
          </div>
          <p className="text-3xl font-black">{money(quote.premiumCalculated, quote.currency)}</p>
          <p className="break-all text-sm">Quote / policy ID: {quote.quoteId}</p>
          {quote.expiresAt && (
            <p className="text-sm">Valid until {new Date(quote.expiresAt).toLocaleString()}</p>
          )}
          {channel === 'DISTRIBUTION' && (
            <p>This partner demonstration ends at the quote. No payment or bind was requested.</p>
          )}
          {channel === 'DIRECT' && quote.bindable && !policy && !review && (
            <Button disabled={busy} onClick={reviewQuote}>
              Review and continue
            </Button>
          )}
          {channel === 'DIRECT' && review && !policy && (
            <>
              <p>
                Retained offer: {money(review.review.premium, review.review.currency)} ·{' '}
                {review.review.offerId}
              </p>
              <Checkbox
                label="I confirm these details and the exact quoted premium for this synthetic policy. No real money will be collected."
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={busy}
              />
              <Button
                className="w-full bg-pink-700 text-white"
                disabled={busy || !confirmed}
                onClick={bind}
              >
                {busy ? 'Completing policy…' : 'Bind demonstration policy'}
              </Button>
            </>
          )}
        </div>
      )}
      {policy && (
        <div role="status" className="space-y-3 rounded-2xl bg-emerald-50 p-5">
          <h2 className="text-xl font-bold">
            {Boolean(policy.issuedAt) && ['ACTIVE', 'ISSUED'].includes(policy.status)
              ? 'Policy issued in Facio'
              : `Facio status: ${policy.status}`}
          </h2>
          <p className="break-all">Policy: {policy.policyNumber || policy.policyId}</p>
          <p>Documents: {policy.documentsStatus || 'Awaiting verified document status'}</p>
          <Button disabled={busy} onClick={refreshPolicy}>
            Refresh policy and documents
          </Button>
          {policy.documentsStatus === 'failed' && (
            <p>
              Document generation needs attention in Facio. The policy status above is unchanged.
            </p>
          )}
          {policy.documents?.map((document) => (
            <Button
              key={document.id}
              disabled={busy || policy.documentsStatus !== 'ready'}
              variant="secondary"
              onClick={() => downloadDocument(document.id, document.filename)}
            >
              Download {document.filename}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
