import { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';
import type { ListPoliciesUseCaseDeps } from '../app/read/listPoliciesUseCase.js';
import {
  buildPolicyDocumentsRepository,
  buildPolicyFeedRepository,
  buildPolicyListWhereFromQuery,
  getPolicyListRegistry,
} from '../app/read/infraAdapters.js';
export { buildEmailPolicyDocumentsDeps } from '../app/read/emailPolicyDocumentsDeps.js';
import { evaluateIssueReadiness } from '../app/issueReadiness.js';
import {
  buildOrderBy,
  buildPolicySearchOrClauses,
  cmpClause,
  decodeCursor,
  dedupePolicyFeedRows,
  encodeCursor,
  eqClause,
  hotViewCacheHitRatePct,
  isClientPublicDocument,
  isVehicleSearchUnknownArgError,
  listFiltersFromQuery,
  normalizeCursorValue,
  normalizeSortRules,
  parseRecord,
  policySortType,
  readHotViewCache,
  readIndexCoverageCache,
  setHotViewCache,
  setIndexCoverageCache,
  shortHash,
  stripVehicleSearchFromWhere,
  USE_POLICY_STATE,
  valueFromPolicy,
} from './readRouter.helpers.js';

function policySelect(isCompact: boolean) {
  if (isCompact) {
    return {
      createdAt: true,
      inceptionDate: true,
      expiryDate: true,
      productType: true,
      paymentStatus: true,
      publicSessionToken: true,
      vehicleInfo: true,
      quoteData: true,
      stateCurrent: { select: { snapshot: true } },
      policyHolder: { select: { name: true, contact: true } },
    };
  }
  return {
    programId: true,
    binderId: true,
    createdAt: true,
    inceptionDate: true,
    expiryDate: true,
    productType: true,
    paymentStatus: true,
    publicSessionToken: true,
    vehicleInfo: true,
    driverInfo: true,
    quoteData: true,
    quoteResponse: true,
    stateCurrent: { select: { snapshot: true } },
    policyHolder: { select: { name: true, contact: true } },
  };
}

export function buildListPolicyDocumentsDeps() {
  return {
    repo: buildPolicyDocumentsRepository(),
    visibility: { isClientPublicDocument },
  };
}

export function buildGetPolicyFeedDeps() {
  return {
    repo: buildPolicyFeedRepository(),
    rules: { dedupePolicyFeedRows },
  };
}

export function buildGetIssueReadinessDeps() {
  return {
    service: {
      evaluateIssueReadiness,
    },
  };
}

export function buildListPoliciesDeps(): ListPoliciesUseCaseDeps {
  const compactIncludePolicyFallback =
    String(process.env.POLICY_COMPACT_INCLUDE_POLICY_FALLBACK || 'true').trim().toLowerCase() !== 'false';
  const registry = getPolicyListRegistry();
  return {
    helpers: {
      parseRecord,
      normalizeSortRules,
      buildOrderBy,
      buildPolicySearchOrClauses,
      listFiltersFromQuery,
      shortHash,
      decodeCursor,
      encodeCursor,
      policySortType,
      normalizeCursorValue,
      eqClause,
      cmpClause,
      valueFromPolicy,
      readHotViewCache,
      setHotViewCache,
      hotViewCacheHitRatePct,
      readIndexCoverageCache,
      setIndexCoverageCache,
      stripVehicleSearchFromWhere,
      isVehicleSearchUnknownArgError,
      USE_POLICY_STATE,
    },
    filtering: {
      buildPolicyListWhereFromQuery(query: Record<string, unknown>) {
        return buildPolicyListWhereFromQuery(query, registry);
      },
    },
    repo: {
      async findPolicyListIndexRows(args: {
        where: Prisma.PolicyListIndexWhereInput;
        take?: number;
        skip?: number;
        orderBy: Prisma.PolicyListIndexOrderByWithRelationInput[];
        isCompact: boolean;
      }) {
        const includePolicy =
          args.isCompact && !compactIncludePolicyFallback
            ? undefined
            : {
                policy: {
                  select: policySelect(args.isCompact),
                },
              };
        return (await tenantScopedPrisma.policyListIndex.findMany({
          where: args.where,
          ...(typeof args.take === 'number' ? { take: args.take } : {}),
          ...(typeof args.skip === 'number' ? { skip: args.skip } : {}),
          orderBy: args.orderBy,
          // Explicit select: only the fields consumed by the policy list UI.
          // Deliberately excludes bo_status_changed_at and cancellationExposureEUR —
          // these are enrichment-only fields used only by the intelligence aggregates,
          // not needed here and not guaranteed to exist on every DB instance.
          select: {
            policyId:               true,
            policyNumber:           true,
            insuredName:            true,
            insuredDisplay:         true,
            vehicleDisplay:         true,
            policyholderDisplay:    true,
            policyholderEmail:      true,
            policyholderPhone:      true,
            coverageStart:          true,
            coverageEnd:            true,
            status:                 true,
            bo_status:              true,
            vehicleSearch:          true,
            address:                true,
            segment:                true,
            totalPremium:           true,
            updatedAt:              true,
            renewalDate:            true,
            quoteExpiryDate:        true,
            lastActivityAt:         true,
            attentionBucket:        true,
            attentionScore:         true,
            statusSortRank:         true,
            bo_statusSortRank:      true,
            hasOpenClaim:           true,
            openClaimCount:         true,
            outstandingBalance:     true,
            invoiceOverdue:         true,
            cancellationPending:    true,
            customerActionRequired: true,
            uwActionRequired:       true,
            complianceState:        true,
            complianceProfile:      true,
            complianceReasons:      true,
            complianceCheckedAt:    true,
            indexUpdatedAt:         true,
            indexVersion:           true,
            ...(includePolicy ? { policy: includePolicy.policy } : {}),
          },
        })) as Array<Record<string, unknown>>;
      },
      countPolicyListIndex(where?: Prisma.PolicyListIndexWhereInput) {
        return tenantScopedPrisma.policyListIndex.count(typeof where === 'undefined' ? undefined : { where });
      },
      countPoliciesAutoInsurance() {
        return tenantScopedPrisma.policy.count({ where: { productType: { not: null } } });
      },
    },
    logger,
  };
}
