import React from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import type { Worksheet } from '@/src/modules/claims/case/model/worksheetTypes';
import { getProductIntakeUI } from '@/src/modules/claims/intake/model/getProductIntakeUI';
import { resolveMotorMissingFields } from '@/src/modules/claims/intake/motor/motorGateFieldMap';
import { FnolSectionRenderer } from './FnolSectionRenderer';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  worksheet: Worksheet;
  busy: boolean;
  onOpenEdit: () => void;
};

export function FnolReviewDrawer({ isOpen, onClose, worksheet, busy, onOpenEdit }: Props) {
  const productUi = getProductIntakeUI(worksheet.summary.claimType);
  const snapshot = (worksheet.intake?.fnol || {}) as Record<string, unknown>;
  const missingFields = resolveMotorMissingFields({ gates: worksheet.intake?.gates || [], snapshot });
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const getByPath = (source: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((acc, segment) => asRecord(acc)[segment], source);
  const hasMeaningfulValue = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase();
      return Boolean(text) && text !== 'false' && text !== 'no' && text !== '0' && text !== 'n/a';
    }
    if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
    if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => hasMeaningfulValue(item));
    return false;
  };
  const visibleSections = (productUi?.sections ?? []).filter((section) => {
    const visibleFields = section.fields.filter((field) => (field.visibleWhen ? field.visibleWhen(snapshot) : true));
    if (!visibleFields.length) return false;
    if (section.id === 'incident') return true;
    const sectionHasData = visibleFields.some((field) => hasMeaningfulValue(getByPath(snapshot, field.path)));
    const sectionHasMissingRequired = missingFields.some((item) => item.sectionId === section.id);
    return sectionHasData || sectionHasMissingRequired;
  });
  const formatEuropeanDateTime = (value?: string) => {
    const raw = String(value || '').trim();
    if (!raw) return 'n/a';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(date);
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(date);
    const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric' }).format(date);
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    return `${day} ${month}, ${year}, ${time}`;
  };
  const intakeAuditEntries = (worksheet.timeline || [])
    .filter((event) => {
      const type = String(event.eventType || '').toUpperCase();
      return type === 'FNOL_SUBMITTED' || type === 'FNOL_SUBMITTED_BY_CUSTOMER' || type === 'FNOL_AMENDED';
    })
    .map((event) => {
      const type = String(event.eventType || '').toUpperCase();
      const fallbackActor =
        type === 'FNOL_SUBMITTED_BY_CUSTOMER'
          ? 'Customer'
          : type === 'FNOL_AMENDED'
            ? 'Handler'
            : 'Reporter';
      return {
        id: event.id,
        actor: String(event.actorName || '').trim() || fallbackActor,
        at: event.occurredAt,
      };
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const changedFieldByPath = Object.fromEntries(
    (worksheet.intake?.changedFields || []).map((field) => [
      field.path,
      { changedAt: field.changedAt, actorName: field.changedBy?.actorName || field.changedBy?.actorId || '' },
    ]),
  );

  const jumpToSection = (sectionId?: string) => {
    if (!sectionId) return;
    const el = document.getElementById(`fnol-review-${sectionId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Current intake details"
      maxWidth="max-w-4xl"
      actions={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={onOpenEdit} disabled={busy}>Edit intake</Button>
        </>
      )}
    >
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 space-y-3">
          <div className="text-sm font-black text-slate-900">Intake snapshot</div>
          <div className="text-sm font-semibold text-slate-600">
            Current intake details captured for this claim.
          </div>
          {intakeAuditEntries.length ? (
            <div className="space-y-1 pt-1">
              {intakeAuditEntries.map((entry) => (
                <div key={entry.id} className="text-xs font-semibold text-slate-500">
                  Edited by {entry.actor} on {formatEuropeanDateTime(entry.at)}
                </div>
              ))}
            </div>
          ) : worksheet.intake?.submittedBy ? (
            <div className="text-xs font-semibold text-slate-500">
              Edited by {worksheet.intake.submittedBy.actorName || worksheet.intake.submittedBy.actorId || 'Unknown'} on {formatEuropeanDateTime(worksheet.intake.submittedAt)}
            </div>
          ) : null}
          {missingFields.length ? (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs font-semibold text-amber-900">
              To confirm intake, complete: {missingFields.map((item) => item.label).slice(0, 4).join(', ')}.
            </div>
          ) : null}
        </section>
        {visibleSections.map((section) => (
          <FnolSectionRenderer
            key={section.id}
            section={section}
            snapshot={snapshot}
            anchorPrefix="fnol-review"
            changedFieldByPath={changedFieldByPath}
          />
        ))}
        {missingFields.length ? (
          <details className="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-wider text-slate-500">Validation details</summary>
            <div className="mt-2 text-xs font-semibold text-slate-600 space-y-1">
              {missingFields.map((item) => (
                <Button
                  key={`${item.gateKey}-${item.path}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="block text-left underline underline-offset-2 hover:text-slate-900 bg-transparent !p-0"
                  onClick={() => jumpToSection(item.sectionId)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </Modal>
  );
}

