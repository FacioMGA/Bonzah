import React from 'react';
import { Button, Input, MoneyInput, Select } from '@/src/shared/ui';
import { useClaimsDeskController } from '@/src/modules/claims/desk/controller/useClaimsDeskController';
import {
  getClaimPaymentOptionalSubtypeOptions,
  getClaimPaymentRoleLabel,
  getClaimPaymentSubtypeOptions,
} from '@/src/modules/claims/desk/model/paymentOptions';

type ClaimsDeskController = ReturnType<typeof useClaimsDeskController>;

type RenderDevelopmentFormArgs = {
  worksheet: ClaimsDeskController['state']['worksheet'];
  local: ClaimsDeskController['local'];
  mutators: ClaimsDeskController['mutators'];
};

export function renderDevelopmentForm(args: RenderDevelopmentFormArgs) {
  const { local, mutators } = args;
  const isReserveSet = local.commandType === 'SET_RESERVE';
  const isReserveAdjust = local.commandType === 'ADJUST_RESERVE';
  const isReserveCommand = isReserveSet || isReserveAdjust;
  const isFinancialCommand = isReserveCommand
    || local.commandType === 'ADD_PAYMENT'
    || local.commandType === 'SET_RECOVERY_EXPECTED'
    || local.commandType === 'ADD_RECOVERY_RECEIVED';

  if (local.commandType === 'ADD_PAYMENT') {
    const paymentCategories = Array.from(
      new Set(local.paymentClassifications.map((item) => item.costCategory)),
    );
    const subtypeOptions = getClaimPaymentSubtypeOptions(args.worksheet, local.devForm.costCategory);
    const optionalSubtypeOptions = getClaimPaymentOptionalSubtypeOptions(args.worksheet, local.devForm.costCategory);
    const isIndemnityCategory = local.devForm.costCategory === 'indemnity';
    const selectedOptionalSubtype = optionalSubtypeOptions.find((item) => item.costSubType === local.devForm.costSubType);
    const canToggleIndemnitySubtype = isIndemnityCategory && optionalSubtypeOptions.length > 0;
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Payment details</div>
          <div className={`grid grid-cols-1 gap-3 ${isIndemnityCategory ? 'md:grid-cols-3' : 'md:grid-cols-4'}`}>
            <Select
              variant="ui"
              data-claim-field="costCategory"
              value={local.devForm.costCategory}
              onChange={(e) => {
                const nextCategory = e.target.value as typeof local.devForm.costCategory;
                const nextSubtype = local.paymentClassifications.find((item) => item.costCategory === nextCategory)?.costSubType || 'other';
                mutators.setDevForm((p) => ({
                  ...p,
                  costCategory: nextCategory,
                  costSubType: nextSubtype,
                  payeeCounterpartyId: '',
                }));
              }}
            >
              {paymentCategories.map((category) => (
                <option key={category} value={category}>
                  {category === 'indemnity' ? 'Indemnity' : 'Fees'}
                </option>
              ))}
            </Select>
            {!isIndemnityCategory ? (
              <Select
                variant="ui"
                data-claim-field="costSubType"
                value={local.devForm.costSubType}
                onChange={(e) => mutators.setDevForm((p) => ({
                  ...p,
                  costSubType: e.target.value as typeof p.costSubType,
                  payeeCounterpartyId: '',
                }))}
              >
                {subtypeOptions.map((item) => (
                  <option key={`${item.costCategory}:${item.costSubType}`} value={item.costSubType}>
                    {item.uiLabel}
                  </option>
                ))}
              </Select>
            ) : null}
            <MoneyInput
              data-claim-field="amount"
              placeholder="0"
              value={local.devForm.amount}
              onValueChange={(next) => mutators.setDevForm((p) => ({ ...p, amount: next }))}
              error={Boolean(local.paymentInlineError)}
            />
            <Select
              variant="ui"
              data-claim-field="paymentType"
              value={local.devForm.paymentType}
              onChange={(e) => mutators.setDevForm((p) => ({ ...p, paymentType: e.target.value }))}
            >
              <option value="INTERIM">Interim</option>
              <option value="FINAL">Final</option>
            </Select>
          </div>
          {canToggleIndemnitySubtype ? (
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-600">
              <span>
                {selectedOptionalSubtype
                  ? `Indemnity subtype: ${selectedOptionalSubtype.uiLabel}`
                  : 'Standard indemnity payment'}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => mutators.setDevForm((p) => ({
                  ...p,
                  costSubType: selectedOptionalSubtype ? 'other' : optionalSubtypeOptions[0]?.costSubType || 'other',
                  payeeCounterpartyId: '',
                  invoiceReference: selectedOptionalSubtype ? '' : p.invoiceReference,
                }))}
              >
                {selectedOptionalSubtype ? 'Use standard indemnity' : `Mark as ${optionalSubtypeOptions[0]?.uiLabel.toLowerCase()}`}
              </Button>
            </div>
          ) : null}
          <div className={`text-xs font-semibold ${local.paymentInlineError ? 'text-rose-600' : 'text-slate-500'}`}>
            Remaining reserve for selected bucket: <span className="font-black">{local.paymentRemainingReserveLabel}</span>
          </div>
          {local.selectedPaymentClassification?.guidance ? (
            <div className="text-xs font-semibold text-amber-700">{local.selectedPaymentClassification.guidance}</div>
          ) : null}
          {local.paymentInlineError ? (
            <div className="text-xs font-semibold text-rose-600">{local.paymentInlineError}</div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Payee</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select
              variant="ui"
              data-claim-field="payeeCounterpartyId"
              value={local.devForm.payeeCounterpartyId}
              onChange={(e) => mutators.setDevForm((p) => ({ ...p, payeeCounterpartyId: e.target.value }))}
            >
              <option value="">Select payee</option>
              {local.eligiblePaymentPayees.map((payee) => {
                const role = payee.roles.find((item) => local.selectedPaymentClassification?.allowedPayeeRoles.includes(item)) || payee.roles[0];
                const roleLabel = role ? getClaimPaymentRoleLabel(role) : '';
                return (
                  <option key={payee.id} value={payee.id}>
                    {[payee.name, roleLabel].filter(Boolean).join(' - ')}
                  </option>
                );
              })}
            </Select>
            <Input
              variant="ui"
              data-claim-field="invoiceReference"
              placeholder={local.selectedPaymentClassification?.requiresInvoiceReference ? 'Invoice reference' : 'Invoice reference (optional)'}
              value={local.devForm.invoiceReference}
              onChange={(e) => mutators.setDevForm((p) => ({ ...p, invoiceReference: e.target.value }))}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Payment note</div>
          <Input
            variant="ui"
            data-claim-field="reason"
            placeholder="Payment note (optional)"
            value={local.devForm.reason}
            onChange={(e) => mutators.setDevForm((p) => ({ ...p, reason: e.target.value }))}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 gap-3 ${isReserveCommand ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
      {isFinancialCommand ? (
        <Select
          variant="ui"
          data-claim-field="bucket"
          value={local.devForm.bucket}
          onChange={(e) => mutators.setDevForm((p) => ({ ...p, bucket: e.target.value }))}
        >
          <option value="INDEMNITY">Indemnity</option>
          <option value="DEFENCE_COSTS">Defence costs</option>
          <option value="ADJUSTER_FEES">Adjuster fees</option>
          <option value="LEGAL_FEES">Legal fees</option>
          <option value="OTHER">Other expenses</option>
        </Select>
      ) : null}
      {isFinancialCommand ? (
        <MoneyInput
          data-claim-field="amount"
          allowNegative={isReserveAdjust}
          placeholder={isReserveAdjust ? '0 (use - to decrease)' : '0'}
          value={local.devForm.amount}
          onValueChange={(next) => mutators.setDevForm((p) => ({ ...p, amount: next }))}
        />
      ) : null}

      {(local.commandType === 'SET_RECOVERY_EXPECTED' || local.commandType === 'ADD_RECOVERY_RECEIVED') ? (
        <Select
          variant="ui"
          data-claim-field="recoveryType"
          value={local.devForm.recoveryType}
          onChange={(e) => mutators.setDevForm((p) => ({ ...p, recoveryType: e.target.value }))}
        >
          <option value="THIRD_PARTY_INSURER">Third party insurer</option>
          <option value="THIRD_PARTY">Third party</option>
          <option value="SALVAGE">Salvage</option>
          <option value="DEDUCTIBLE">Excess / deductible</option>
          <option value="REINSURANCE">Reinsurance</option>
          <option value="OTHER">Other</option>
        </Select>
      ) : null}

      {(local.commandType === 'CREATE_APPOINTMENT') ? (
        <>
          <Select
            variant="ui"
            data-claim-field="appointeeType"
            value={local.devForm.appointeeType}
            onChange={(e) => mutators.setDevForm((p) => ({ ...p, appointeeType: e.target.value }))}
          >
            <option value="ADJUSTER">Adjuster</option>
            <option value="LAWYER">Lawyer</option>
            <option value="GARAGE">Garage</option>
            <option value="ENGINEER">Engineer</option>
            <option value="INVESTIGATOR">Investigator</option>
            <option value="MEDICAL_EXPERT">Medical expert</option>
            <option value="OTHER">Other</option>
          </Select>
          <Input
            variant="ui"
            data-claim-field="appointee"
            placeholder="Appointee"
            value={local.devForm.appointee}
            onChange={(e) => mutators.setDevForm((p) => ({ ...p, appointee: e.target.value }))}
          />
        </>
      ) : null}

      {(local.commandType === 'DENY_CLAIM') ? (
        <Select
          variant="ui"
          data-claim-field="denialReason"
          value={local.devForm.denialReason}
          onChange={(e) => mutators.setDevForm((p) => ({ ...p, denialReason: e.target.value }))}
        >
          <option value="NO_POLICY_COVER">No policy cover</option>
          <option value="EXCLUSION_APPLIES">Exclusion applies</option>
          <option value="POLICY_NOT_IN_FORCE">Policy not in force</option>
          <option value="NON_DISCLOSURE_MISREPRESENTATION">Non-disclosure / misrepresentation</option>
          <option value="BREACH_OF_POLICY_CONDITIONS">Breach of policy conditions</option>
          <option value="FRAUD_SUSPECTED_CONFIRMED">Fraud suspected / confirmed</option>
          <option value="DUPLICATE_CLAIM">Duplicate claim</option>
          <option value="NO_INSURED_LOSS_ESTABLISHED">No insured loss established</option>
          <option value="OTHER">Other</option>
        </Select>
      ) : null}

      {local.commandType === 'CLOSE' ? (
        <Select
          variant="ui"
          data-claim-field="closureReason"
          value={local.devForm.closureReason}
          onChange={(e) => mutators.setDevForm((p) => ({ ...p, closureReason: e.target.value }))}
        >
          <option value="SETTLED">Settled</option>
          <option value="SETTLED_WITHOUT_PAYMENT">Settled without payment</option>
          <option value="INSURED_WITHDREW_CLAIM">Insured withdrew claim</option>
          <option value="CLAIM_REPORTED_IN_ERROR">Claim reported in error</option>
          <option value="DUPLICATE_CLAIM">Duplicate claim</option>
          <option value="NO_FURTHER_ACTION_REQUIRED">No further action required</option>
          <option value="ADMINISTRATIVE_CLOSURE">Administrative closure</option>
          <option value="OTHER">Other</option>
        </Select>
      ) : null}

      {local.commandType === 'REOPEN' ? (
        <Select
          variant="ui"
          data-claim-field="reopenReason"
          value={local.devForm.reopenReason}
          onChange={(e) => mutators.setDevForm((p) => ({ ...p, reopenReason: e.target.value }))}
        >
          <option value="NEW_INFORMATION_RECEIVED">New information received</option>
          <option value="ADDITIONAL_DAMAGE_DISCOVERED">Additional damage discovered</option>
          <option value="CLAIM_REOPENED_BY_REQUEST">Claim reopened by request</option>
          <option value="RECOVERY_ACTIVITY_RESUMED">Recovery activity resumed</option>
          <option value="CLOSURE_MADE_IN_ERROR">Closure made in error</option>
          <option value="OTHER">Other</option>
        </Select>
      ) : null}

      {local.commandType === 'ADD_CLAIM_EVIDENCE' ? (
        <>
          <Select
            variant="ui"
            data-claim-field="documentType"
            value={local.devForm.documentType}
            onChange={(e) => mutators.setDevForm((p) => ({ ...p, documentType: e.target.value }))}
          >
            <option value="PHOTO">Photo</option>
            <option value="POLICE_REPORT">Police report</option>
            <option value="REPAIR_ESTIMATE">Repair estimate</option>
            <option value="INVOICE">Invoice</option>
            <option value="STATEMENT">Statement</option>
            <option value="MEDICAL_REPORT">Medical report</option>
            <option value="OTHER">Other</option>
          </Select>
          <Input
            variant="ui"
            data-claim-field="evidenceFile"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.docx"
            onChange={(e) => mutators.setEvidenceFile(e.target.files?.[0] || null)}
          />
        </>
      ) : null}

      {(local.commandType === 'SET_RESERVE' || local.commandType === 'ADJUST_RESERVE' || local.commandType === 'SET_RECOVERY_EXPECTED' || local.commandType === 'ADD_RECOVERY_RECEIVED' || local.commandType === 'CREATE_APPOINTMENT') ? (
        <Input
          variant="ui"
          data-claim-field={local.commandType === 'CREATE_APPOINTMENT' ? 'instruction' : 'reason'}
          placeholder={
            isReserveCommand
              ? 'Reserve note (optional)'
              : local.commandType === 'SET_RECOVERY_EXPECTED' || local.commandType === 'ADD_RECOVERY_RECEIVED'
                  ? 'Recovery note (optional)'
                  : local.commandType === 'CREATE_APPOINTMENT'
                    ? 'Instruction'
                    : 'Explanation'
          }
          value={local.commandType === 'CREATE_APPOINTMENT' ? local.devForm.instruction : local.devForm.reason}
          onChange={(e) => {
            if (local.commandType === 'CREATE_APPOINTMENT') {
              mutators.setDevForm((p) => ({ ...p, instruction: e.target.value }));
              return;
            }
            mutators.setDevForm((p) => ({ ...p, reason: e.target.value }));
          }}
          className={isReserveCommand || local.commandType === 'SET_RECOVERY_EXPECTED' || local.commandType === 'ADD_RECOVERY_RECEIVED' || local.commandType === 'CREATE_APPOINTMENT' ? 'md:col-span-3' : ''}
        />
      ) : null}

      {local.commandType === 'DENY_CLAIM' ? (
        <>
          <Input
            variant="ui"
            data-claim-field="summary"
            placeholder="Decision summary"
            value={local.devForm.summary}
            onChange={(e) => mutators.setDevForm((p) => ({ ...p, summary: e.target.value }))}
            className="md:col-span-3"
          />
          <Input
            variant="ui"
            data-claim-field="reason"
            placeholder="Detailed note (optional)"
            value={local.devForm.reason}
            onChange={(e) => mutators.setDevForm((p) => ({ ...p, reason: e.target.value }))}
            className="md:col-span-3"
          />
        </>
      ) : null}

      {(local.commandType === 'CLOSE' || local.commandType === 'REOPEN') ? (
        <Input
          variant="ui"
          data-claim-field="summary"
          placeholder={local.commandType === 'CLOSE' ? 'Closure summary' : 'Reopen summary'}
          value={local.devForm.summary}
          onChange={(e) => mutators.setDevForm((p) => ({ ...p, summary: e.target.value }))}
          className="md:col-span-3"
        />
      ) : null}

      {(local.commandType === 'CLOSE' || local.commandType === 'REOPEN' || local.commandType === 'ADD_CLAIM_EVIDENCE') ? (
        <Input
          variant="ui"
          data-claim-field="reason"
          placeholder={local.commandType === 'ADD_CLAIM_EVIDENCE' ? 'Document note (optional)' : local.commandType === 'CLOSE' ? 'Closure note (optional)' : 'Reopen note (optional)'}
          value={local.devForm.reason}
          onChange={(e) => mutators.setDevForm((p) => ({ ...p, reason: e.target.value }))}
          className="md:col-span-3"
        />
      ) : null}

      {local.commandType === 'ADD_CLAIM_NOTE' ? (
        <Input
          variant="ui"
          data-claim-field="reason"
          placeholder="Add an internal note about this claim"
          value={local.devForm.reason}
          onChange={(e) => mutators.setDevForm((p) => ({ ...p, reason: e.target.value }))}
          className="md:col-span-3"
        />
      ) : null}
    </div>
  );
}
