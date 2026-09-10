import React from 'react';
import type { Location, NavigateFunction } from 'react-router-dom';
import { ClaimsDeskList } from '@/src/modules/claims/desk/list/ClaimsDeskList';
import { ClaimsDeskDetail } from '@/src/modules/claims/desk/views/ClaimsDeskDetail';
import { ClaimsDeskHeaderStrip } from '@/src/modules/claims/desk/components/ClaimsDeskHeaderStrip';
import { ClaimsDeskTabSwitch } from '@/src/modules/claims/desk/views/ClaimsDeskTabSwitch';
import { useClaimsDeskCtrl } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';
import { humanClaimKind, money } from '@/src/modules/claims/model/selectors';
import { Button, Card } from '@/src/shared/ui';

type ClaimsDeskTabsViewProps = {
  location: Location;
  navigate: NavigateFunction;
};

export function ClaimsDeskTabsView(props: ClaimsDeskTabsViewProps) {
  const { location, navigate } = props;
  const ctrl = useClaimsDeskCtrl();
  const { state, derived, local, mutators } = ctrl;

  if (!state.isDetailView) {
    return (
      <ClaimsDeskList onCreateNewCase={() => {
        mutators.setNewCaseStep(1);
        mutators.setNewCaseMode('KNOWN');
        mutators.setShowCreateModal(true);
      }} />
    );
  }

  return (
    <ClaimsDeskDetail loading={state.loading} worksheet={state.worksheet}>
      {state.worksheet ? (
        <>
          <ClaimsDeskHeaderStrip
            caseMode={derived.caseMode}
            claimTypeLabel={humanClaimKind(state.worksheet.summary.claimType || '')}
            anchorTitle={state.detailPolicy?.anchorTitle || `Policy ${state.worksheet.policyNumber}`}
            policyNumberLabel={derived.caseMode ? 'Policy not linked' : (state.detailPolicy?.policyNumber || state.worksheet.policyNumber)}
            claimReference={state.worksheet.claimReference}
            handlerName={state.worksheet.topBar.lastActorName}
            totalIncurredText={money(state.worksheet.summary.financials.totalIncurred, state.detailPolicy?.currency || state.worksheet.summary.cr0109_original_currency || 'EUR')}
            netExposureText={money(state.worksheet.summary.financials.netIncurred, state.detailPolicy?.currency || state.worksheet.summary.cr0109_original_currency || 'EUR')}
            intakeStatusPill={derived.intakeStatusPill}
            awaitingFnolResponse={derived.awaitingFnolResponse}
            auditIndicator={derived.auditIndicator}
            onBack={() => navigate('/claims')}
          />

          <Card className="-flat bg-brand-canvas border-none">
            <nav className="ui-tabsbar">
              {derived.visibleTabs.map((tab) => (
                <Button
                  key={tab.id}
                  onClick={() => navigate(`${location.pathname}#${tab.id}`)}
                  variant="tab"
                  size="tab"
                  className={`ui-tab ${local.activeTab === tab.id ? 'ui-tab-active' : 'ui-tab-inactive'}`}
                >
                  {tab.label}
                </Button>
              ))}
            </nav>
            <div className="px-0 pt-4 pb-8 bg-brand-canvas min-h-workspace">
              <ClaimsDeskTabSwitch />
            </div>
          </Card>
        </>
      ) : null}
    </ClaimsDeskDetail>
  );
}
