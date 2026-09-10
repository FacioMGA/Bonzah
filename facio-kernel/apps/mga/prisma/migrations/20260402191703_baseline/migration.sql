-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'UNDERWRITER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('INTERNAL', 'BROKER', 'CUSTOMER', 'PARTNER');

-- CreateEnum
CREATE TYPE "AccessRoleType" AS ENUM ('SYSTEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('GLOBAL', 'PRODUCT', 'BINDER', 'OWN_RECORDS');

-- CreateEnum
CREATE TYPE "AccountUserRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('PERSON', 'ORGANIZATION', 'VEHICLE', 'ASSET');

-- CreateEnum
CREATE TYPE "UserOtpPurpose" AS ENUM ('EMAIL_VERIFICATION', 'LOGIN', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "name" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" "Role" NOT NULL DEFAULT 'UNDERWRITER',
    "userType" "UserType" NOT NULL DEFAULT 'INTERNAL',
    "password" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT,
    "inviteToken" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "primaryAccountId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "AccessRoleType" NOT NULL DEFAULT 'CUSTOM',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "constraints" JSONB,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "constraints" JSONB,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "access_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scopeValue" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "access_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "kind" "AccountKind" NOT NULL DEFAULT 'CUSTOMER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_users" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AccountUserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "type" "EntityType" NOT NULL,
    "name" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_otps" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "purpose" "UserOtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_holders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segment" TEXT,
    "address" TEXT,
    "contact" TEXT,
    "bankAccounts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_summary_projection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "secondaryIdentity" TEXT,
    "ownerBroker" TEXT,
    "activePoliciesCount" INTEGER NOT NULL DEFAULT 0,
    "openClaimsCount" INTEGER NOT NULL DEFAULT 0,
    "outstandingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "annualizedPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "renewalIn30DaysCount" INTEGER NOT NULL DEFAULT 0,
    "renewalIn60DaysCount" INTEGER NOT NULL DEFAULT 0,
    "billingIssueCount" INTEGER NOT NULL DEFAULT 0,
    "healthStatus" TEXT NOT NULL DEFAULT 'HEALTHY',
    "healthScore" INTEGER NOT NULL DEFAULT 0,
    "healthReasons" JSONB,
    "healthRuleVersion" INTEGER NOT NULL DEFAULT 1,
    "lastActivityAt" TIMESTAMP(3),
    "lastActivityType" TEXT,
    "lastActivitySummary" TEXT,
    "productMix" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_summary_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_portfolio_metrics" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "activePoliciesCount" INTEGER NOT NULL DEFAULT 0,
    "draftPoliciesCount" INTEGER NOT NULL DEFAULT 0,
    "expiredPoliciesCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledPoliciesCount" INTEGER NOT NULL DEFAULT 0,
    "annualizedPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "productMix" JSONB,
    "renewalBuckets" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_portfolio_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_alerts_projection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "alertCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "sourceDomain" TEXT NOT NULL,
    "sourceRefId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_alerts_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_activity_feed" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventSummary" TEXT NOT NULL,
    "aggregateType" TEXT,
    "aggregateId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_activity_feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "public_session_token" TEXT,
    "certificateNumber" TEXT,
    "greenCardSerial" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "paymentStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "issueReadiness" JSONB,
    "accountId" TEXT,
    "insuredEntityId" TEXT,
    "programId" TEXT,
    "binderId" TEXT,
    "umr" TEXT,
    "status" TEXT NOT NULL,
    "bo_status" TEXT,
    "inceptionDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "currentEndorsementId" TEXT,
    "policyHolderId" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT 'AUTO_INSURANCE',
    "vehicleInfo" JSONB,
    "driverInfo" JSONB,
    "quoteData" JSONB,
    "quoteResponse" JSONB,
    "vehicleRegistrationCountry" TEXT,
    "vehicleRegistrationNumber" TEXT,
    "vehicleTypeCode" TEXT,
    "coverTypeCode" TEXT,
    "excessAmount" DECIMAL(65,30),
    "sumInsuredAmount" DECIMAL(65,30),
    "originalCurrency" TEXT,
    "insuredCountry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_email_states" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "inviteSentAt" TIMESTAMP(3),
    "chaserSentAt" TIMESTAMP(3),
    "inviteAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "chaserAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewal_email_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reco_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "productType" TEXT NOT NULL DEFAULT 'AUTO_INSURANCE',
    "policyId" TEXT NOT NULL,
    "quoteRef" TEXT,
    "type" TEXT NOT NULL,
    "artifactVersion" TEXT,
    "modelKey" TEXT,
    "shownBundleIds" JSONB,
    "selectedBundleId" TEXT,
    "featuresHash" TEXT,
    "features" JSONB,
    "uiContext" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reco_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reco_bandit_arms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "productType" TEXT NOT NULL DEFAULT 'AUTO_INSURANCE',
    "bundleId" TEXT NOT NULL,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reco_bandit_arms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_vectors" (
    "policyId" TEXT NOT NULL,
    "embedding" vector(1536),
    "riskScore" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_vectors_pkey" PRIMARY KEY ("policyId")
);

-- CreateTable
CREATE TABLE "policy_quote_history" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "quoteData" JSONB NOT NULL,
    "quoteResponse" JSONB,
    "isLockedSnapshot" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_quote_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endorsements" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "endorsementNo" INTEGER NOT NULL,
    "transactionType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "snapshot" JSONB NOT NULL,
    "delta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "endorsements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_state_current" (
    "policyId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_state_current_pkey" PRIMARY KEY ("policyId")
);

-- CreateTable
CREATE TABLE "policy_search_index" (
    "policyId" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "insuredName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bo_status" TEXT,
    "address" TEXT,
    "segment" TEXT,
    "totalPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_search_index_pkey" PRIMARY KEY ("policyId")
);

-- CreateTable
CREATE TABLE "policy_list_index" (
    "policyId" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "insuredName" TEXT NOT NULL,
    "insured_display" TEXT,
    "vehicle_display" TEXT,
    "policyholder_display" TEXT,
    "policyholder_email" TEXT,
    "policyholder_phone" TEXT,
    "coverage_start" TIMESTAMP(3),
    "coverage_end" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "bo_status" TEXT,
    "vehicle_search" TEXT,
    "address" TEXT,
    "segment" TEXT,
    "totalPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewalDate" TIMESTAMP(3),
    "quoteExpiryDate" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attentionBucket" TEXT NOT NULL DEFAULT 'NORMAL',
    "attentionScore" INTEGER NOT NULL DEFAULT 0,
    "statusSortRank" INTEGER NOT NULL DEFAULT 999,
    "bo_status_sort_rank" INTEGER,
    "hasOpenClaim" BOOLEAN NOT NULL DEFAULT false,
    "openClaimCount" INTEGER NOT NULL DEFAULT 0,
    "outstandingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "invoiceOverdue" BOOLEAN NOT NULL DEFAULT false,
    "cancellationPending" BOOLEAN NOT NULL DEFAULT false,
    "customerActionRequired" BOOLEAN NOT NULL DEFAULT false,
    "uwActionRequired" BOOLEAN NOT NULL DEFAULT false,
    "complianceState" TEXT NOT NULL DEFAULT 'PASS',
    "complianceProfile" TEXT NOT NULL DEFAULT 'PRODUCTION_STRICT',
    "complianceReasons" JSONB,
    "complianceCheckedAt" TIMESTAMP(3),
    "bo_status_changed_at" TIMESTAMP(3),
    "cancellation_exposure_eur" DECIMAL(65,30),
    "indexUpdatedAt" TIMESTAMP(3) NOT NULL,
    "indexVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "policy_list_index_pkey" PRIMARY KEY ("policyId")
);

-- CreateTable
CREATE TABLE "policy_number_sequences" (
    "key" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "policy_number_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "program_rating_models" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "name" TEXT,
    "notes" TEXT,
    "stages" JSONB NOT NULL,
    "tables" JSONB NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_rating_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_kpis" (
    "id" TEXT NOT NULL DEFAULT 'montly_snap',
    "unitsActive" INTEGER NOT NULL,
    "gwp" DECIMAL(65,30) NOT NULL,
    "netPremium" DECIMAL(65,30) NOT NULL,
    "openClaims" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "defaultRate" DECIMAL(65,30) NOT NULL DEFAULT 0.23,
    "commissions" TEXT NOT NULL,
    "localQuoteTemplatePath" TEXT,
    "localCertificateTemplatePath" TEXT,
    "localInvoiceTemplatePath" TEXT,
    "bordereauxTemplatePath" TEXT,
    "sendgridAutoQuoteInitialTemplateId" TEXT,
    "sendgridAutoQuoteResendTemplateId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "policyId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidDate" TIMESTAMP(3),
    "commissionRate" DECIMAL(65,30) NOT NULL DEFAULT 0.15,
    "pdfUrl" TEXT,
    "googleDocUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "riskTransactionId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'CARDCORP',
    "purpose" TEXT,
    "initiatedBy" TEXT,
    "idempotencyKey" TEXT,
    "entityId" TEXT,
    "checkoutId" TEXT,
    "integrity" TEXT,
    "paymentId" TEXT,
    "merchantTransactionId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentType" TEXT NOT NULL DEFAULT 'DB',
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT,
    "payload" JSONB,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "policyId" TEXT,
    "endorsementId" TEXT,
    "type" TEXT NOT NULL,
    "docPack" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "templateVersion" TEXT,
    "generatedByUserId" TEXT,
    "source" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "riskTransactionId" TEXT,
    "storageUri" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sets" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "files" JSONB NOT NULL,
    "renderingInputsHash" TEXT NOT NULL,
    "scheduleJsonKey" TEXT,
    "bordereauReady" BOOLEAN NOT NULL DEFAULT false,
    "validationErrors" TEXT,
    "supersedesId" TEXT,
    "notes" TEXT,
    "initiatedBy" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "idempotencyKey" TEXT,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanction_screening_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "policyId" TEXT,
    "quoteSessionId" TEXT,
    "customerId" TEXT,
    "provider" TEXT NOT NULL,
    "providerSearchId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "countryCodes" JSONB,
    "threshold" INTEGER NOT NULL,
    "datasets" JSONB NOT NULL,
    "actionType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "providerStatus" TEXT,
    "providerRiskRating" TEXT,
    "requestJson" JSONB NOT NULL,
    "responseJson" JSONB NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanction_screening_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_decisions" (
    "id" TEXT NOT NULL,
    "screeningRunId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_processing_log" (
    "eventId" TEXT NOT NULL,
    "consumerName" TEXT NOT NULL,
    "jobId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_processing_log_pkey" PRIMARY KEY ("eventId","consumerName")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "policyId" TEXT,
    "firstNotifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "policyLinkedAt" TIMESTAMP(3),
    "claimNumber" TEXT NOT NULL,
    "incidentDate" TIMESTAMP(3) NOT NULL,
    "reportedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "claimType" TEXT,
    "description" TEXT,
    "data" JSONB,
    "certificateReference" TEXT,
    "originalCurrency" TEXT,
    "lossCountry" TEXT,
    "causeOfLossCode" TEXT,
    "lossDescription" TEXT,
    "dateOfLossFrom" TIMESTAMP(3),
    "dateOfLossTo" TIMESTAMP(3),
    "amountReserved" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "documents" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_events" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL DEFAULT 'CLAIM',
    "aggregateId" TEXT NOT NULL,
    "aggregateVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "correlationId" TEXT,
    "causationId" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_projection_snapshots" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "projectionVersion" INTEGER NOT NULL DEFAULT 1,
    "asOf" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "paidIndemnity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidFees" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reserveIndemnity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reserveFees" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "recoveriesReceived" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "recoveriesExpected" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "referredToUw" BOOLEAN NOT NULL DEFAULT false,
    "denied" BOOLEAN NOT NULL DEFAULT false,
    "deniedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_projection_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_pros" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_pros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_assignments" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "proId" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,

    CONSTRAINT "claim_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_reserve_transactions" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "claim_reserve_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_info_requests" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedByUserId" TEXT,
    "responseMessage" TEXT,
    "responseDocuments" JSONB,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,

    CONSTRAINT "claim_info_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "payer" TEXT,
    "invoiceId" TEXT,
    "policyId" TEXT,
    "paymentId" TEXT,
    "provider" TEXT,
    "paymentReference" TEXT NOT NULL,
    "paymentAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "direction" TEXT,
    "status" TEXT NOT NULL,
    "matchedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "exceptionNotes" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binders" (
    "id" TEXT NOT NULL,
    "coverholderName" TEXT NOT NULL,
    "coverholderPin" TEXT,
    "umr" TEXT NOT NULL,
    "agreementNumber" TEXT NOT NULL,
    "lloydsReportingVer" TEXT NOT NULL DEFAULT 'V5.2',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "settlementCurrency" TEXT NOT NULL DEFAULT 'USD',
    "config" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "etag" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "binders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binder_documents" (
    "id" TEXT NOT NULL,
    "binderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT,
    "storageUri" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "meta" JSONB,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,

    CONSTRAINT "binder_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binder_parties" (
    "id" TEXT NOT NULL,
    "binderId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "partySubtype" TEXT,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "address" JSONB,
    "contact" JSONB,
    "rolesMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "binder_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binder_coverages" (
    "id" TEXT NOT NULL,
    "binderId" TEXT NOT NULL,
    "coverageCode" TEXT NOT NULL,
    "title" TEXT,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "maxLimit" JSONB,
    "deductible" JSONB,
    "partyLimits" JSONB,
    "wordingAnchorClauseId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "binder_coverages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binder_clauses" (
    "id" TEXT NOT NULL,
    "binderId" TEXT NOT NULL,
    "clauseType" TEXT NOT NULL,
    "textFragment" TEXT NOT NULL,
    "pointer" JSONB,
    "codes" TEXT[],
    "meta" JSONB,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "binder_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binder_financials" (
    "binderId" TEXT NOT NULL,
    "maxLine" DECIMAL(65,30) DEFAULT 0,
    "grossPremiumLimit" DECIMAL(65,30) DEFAULT 0,
    "notifiablePercent" INTEGER,
    "commissionRate" DECIMAL(65,30) DEFAULT 0,
    "profitCommission" JSONB,
    "premiumAccount" JSONB,

    CONSTRAINT "binder_financials_pkey" PRIMARY KEY ("binderId")
);

-- CreateTable
CREATE TABLE "binder_reporting" (
    "binderId" TEXT NOT NULL,
    "writtenRiskSchedule" TEXT,
    "paidClaimsSchedule" TEXT,
    "bordereauFormat" TEXT,
    "destination" JSONB,
    "reportingContacts" JSONB,

    CONSTRAINT "binder_reporting_pkey" PRIMARY KEY ("binderId")
);

-- CreateTable
CREATE TABLE "program_binder_links" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "binderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_binder_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_periods" (
    "id" TEXT NOT NULL,
    "binderId" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_transactions" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "programId" TEXT,
    "binderId" TEXT,
    "reportingPeriodId" TEXT,
    "transactionNumber" INTEGER NOT NULL,
    "transactionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "changeReason" TEXT,
    "paymentMode" TEXT,
    "paymentNote" TEXT,
    "issuedByUserId" TEXT,
    "endorsementId" TEXT,
    "snapshotDraft" JSONB,
    "snapshotFinal" JSONB,
    "pricingFinal" JSONB,
    "snapshotHash" TEXT,
    "pricingHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "risk_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_transactions" (
    "id" TEXT NOT NULL,
    "riskTransactionId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "grossPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "commissionPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxesTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "feesTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netToLondon" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "premium_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_lines" (
    "id" TEXT NOT NULL,
    "premiumTransactionId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "jurisdiction" TEXT,
    "taxType" TEXT,
    "taxableAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "rate" DECIMAL(65,30),

    CONSTRAINT "tax_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magicb_slugs" (
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dataType" TEXT NOT NULL,
    "piiClass" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magicb_slugs_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "magicb_rules" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "contextFilter" JSONB NOT NULL,
    "ruleBody" JSONB NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'BLOCK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magicb_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magicb_mappings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bindingType" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "columnName" TEXT,
    "jsonPath" TEXT,

    CONSTRAINT "magicb_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "reportingPeriodId" TEXT NOT NULL,
    "streamType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "outputFileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_rows" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "rowHash" TEXT NOT NULL,
    "lineage" JSONB,

    CONSTRAINT "report_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_actions" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT,
    "actionName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "diff" JSONB,
    "hash" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endorsement_templates_mbe" (
    "id" TEXT NOT NULL,
    "programCode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "parametersSchema" JSONB NOT NULL,
    "defaultParams" JSONB,
    "rules" JSONB NOT NULL,
    "ui" JSONB,
    "documentTemplate" TEXT,
    "requiresUnderwriterApproval" BOOLEAN NOT NULL DEFAULT false,
    "allowedWith" TEXT[],
    "disallowedWith" TEXT[],
    "jurisdiction" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "endorsement_templates_mbe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endorsement_instances_mbe" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT,
    "params" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "documentKey" TEXT,
    "documentRef" TEXT,
    "sha256" TEXT,
    "premiumDelta" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "endorsement_instances_mbe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endorsement_bundles_mbe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "programCode" TEXT NOT NULL,
    "endorsements" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "endorsement_bundles_mbe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_threads" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "primaryPartyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "communicationType" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "fromActor" TEXT NOT NULL,
    "toRecipients" JSONB NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "externalRefs" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "subjectTemplate" TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "variablesSchema" JSONB NOT NULL,
    "ownership" TEXT NOT NULL DEFAULT 'GLOBAL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_participants" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactRole" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "preferred" TEXT,
    "consent" JSONB,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_delivery_attempts" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalId" TEXT,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "communication_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteToken_key" ON "users"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "access_roles_name_key" ON "access_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_resource_action_key" ON "permissions"("resource", "action");

-- CreateIndex
CREATE INDEX "access_assignments_userId_idx" ON "access_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "access_assignments_userId_roleId_scopeType_scopeValue_key" ON "access_assignments"("userId", "roleId", "scopeType", "scopeValue");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_accountId_idx" ON "api_keys"("accountId");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "webhook_endpoints_accountId_idx" ON "webhook_endpoints"("accountId");

-- CreateIndex
CREATE INDEX "account_users_userId_idx" ON "account_users"("userId");

-- CreateIndex
CREATE INDEX "account_users_accountId_idx" ON "account_users"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "account_users_accountId_userId_key" ON "account_users"("accountId", "userId");

-- CreateIndex
CREATE INDEX "entities_accountId_idx" ON "entities"("accountId");

-- CreateIndex
CREATE INDEX "entities_type_idx" ON "entities"("type");

-- CreateIndex
CREATE INDEX "user_otps_email_idx" ON "user_otps"("email");

-- CreateIndex
CREATE INDEX "user_otps_userId_idx" ON "user_otps"("userId");

-- CreateIndex
CREATE INDEX "user_otps_expiresAt_idx" ON "user_otps"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "account_summary_projection_accountId_key" ON "account_summary_projection"("accountId");

-- CreateIndex
CREATE INDEX "account_summary_projection_healthStatus_idx" ON "account_summary_projection"("healthStatus");

-- CreateIndex
CREATE INDEX "account_summary_projection_lastActivityAt_idx" ON "account_summary_projection"("lastActivityAt");

-- CreateIndex
CREATE INDEX "account_summary_projection_accountName_idx" ON "account_summary_projection"("accountName");

-- CreateIndex
CREATE UNIQUE INDEX "account_portfolio_metrics_accountId_key" ON "account_portfolio_metrics"("accountId");

-- CreateIndex
CREATE INDEX "account_portfolio_metrics_annualizedPremium_idx" ON "account_portfolio_metrics"("annualizedPremium");

-- CreateIndex
CREATE INDEX "account_alerts_projection_accountId_isOpen_idx" ON "account_alerts_projection"("accountId", "isOpen");

-- CreateIndex
CREATE INDEX "account_alerts_projection_accountId_severity_idx" ON "account_alerts_projection"("accountId", "severity");

-- CreateIndex
CREATE INDEX "account_alerts_projection_occurredAt_idx" ON "account_alerts_projection"("occurredAt");

-- CreateIndex
CREATE INDEX "account_activity_feed_accountId_occurredAt_idx" ON "account_activity_feed"("accountId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "account_activity_feed_sourceDomain_eventType_idx" ON "account_activity_feed"("sourceDomain", "eventType");

-- CreateIndex
CREATE INDEX "programs_status_idx" ON "programs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "policies_policyNumber_key" ON "policies"("policyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "policies_public_session_token_key" ON "policies"("public_session_token");

-- CreateIndex
CREATE UNIQUE INDEX "policies_certificateNumber_key" ON "policies"("certificateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "policies_greenCardSerial_key" ON "policies"("greenCardSerial");

-- CreateIndex
CREATE INDEX "policies_policyHolderId_idx" ON "policies"("policyHolderId");

-- CreateIndex
CREATE INDEX "policies_accountId_idx" ON "policies"("accountId");

-- CreateIndex
CREATE INDEX "policies_insuredEntityId_idx" ON "policies"("insuredEntityId");

-- CreateIndex
CREATE INDEX "policies_programId_idx" ON "policies"("programId");

-- CreateIndex
CREATE INDEX "policies_binderId_idx" ON "policies"("binderId");

-- CreateIndex
CREATE INDEX "policies_status_idx" ON "policies"("status");

-- CreateIndex
CREATE INDEX "policies_bo_status_idx" ON "policies"("bo_status");

-- CreateIndex
CREATE INDEX "policies_productType_idx" ON "policies"("productType");

-- CreateIndex
CREATE INDEX "policies_inceptionDate_idx" ON "policies"("inceptionDate");

-- CreateIndex
CREATE INDEX "policies_expiryDate_idx" ON "policies"("expiryDate");

-- CreateIndex
CREATE INDEX "policies_createdAt_idx" ON "policies"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "renewal_email_states_policyId_key" ON "renewal_email_states"("policyId");

-- CreateIndex
CREATE INDEX "renewal_email_states_inviteSentAt_idx" ON "renewal_email_states"("inviteSentAt");

-- CreateIndex
CREATE INDEX "renewal_email_states_chaserSentAt_idx" ON "renewal_email_states"("chaserSentAt");

-- CreateIndex
CREATE INDEX "reco_events_policyId_idx" ON "reco_events"("policyId");

-- CreateIndex
CREATE INDEX "reco_events_quoteRef_idx" ON "reco_events"("quoteRef");

-- CreateIndex
CREATE INDEX "reco_events_type_idx" ON "reco_events"("type");

-- CreateIndex
CREATE INDEX "reco_events_occurredAt_idx" ON "reco_events"("occurredAt");

-- CreateIndex
CREATE INDEX "reco_bandit_arms_tenantId_productType_idx" ON "reco_bandit_arms"("tenantId", "productType");

-- CreateIndex
CREATE UNIQUE INDEX "reco_bandit_arms_tenantId_productType_bundleId_key" ON "reco_bandit_arms"("tenantId", "productType", "bundleId");

-- CreateIndex
CREATE INDEX "policy_quote_history_policyId_idx" ON "policy_quote_history"("policyId");

-- CreateIndex
CREATE INDEX "policy_quote_history_policyId_version_idx" ON "policy_quote_history"("policyId", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "policy_quote_history_policyId_version_key" ON "policy_quote_history"("policyId", "version");

-- CreateIndex
CREATE INDEX "endorsements_policyId_idx" ON "endorsements"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "endorsements_policyId_endorsementNo_key" ON "endorsements"("policyId", "endorsementNo");

-- CreateIndex
CREATE INDEX "policy_list_index_status_idx" ON "policy_list_index"("status");

-- CreateIndex
CREATE INDEX "policy_list_index_bo_status_idx" ON "policy_list_index"("bo_status");

-- CreateIndex
CREATE INDEX "policy_list_index_vehicle_search_idx" ON "policy_list_index"("vehicle_search");

-- CreateIndex
CREATE INDEX "policy_list_index_attentionScore_lastActivityAt_idx" ON "policy_list_index"("attentionScore", "lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "policy_list_index_statusSortRank_idx" ON "policy_list_index"("statusSortRank");

-- CreateIndex
CREATE INDEX "policy_list_index_bo_status_sort_rank_idx" ON "policy_list_index"("bo_status_sort_rank");

-- CreateIndex
CREATE INDEX "policy_list_index_lastActivityAt_idx" ON "policy_list_index"("lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "policy_list_index_updatedAt_idx" ON "policy_list_index"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "policy_list_index_renewalDate_idx" ON "policy_list_index"("renewalDate");

-- CreateIndex
CREATE INDEX "policy_list_index_quoteExpiryDate_idx" ON "policy_list_index"("quoteExpiryDate");

-- CreateIndex
CREATE INDEX "policy_list_index_policyNumber_idx" ON "policy_list_index"("policyNumber");

-- CreateIndex
CREATE INDEX "policy_list_index_totalPremium_idx" ON "policy_list_index"("totalPremium");

-- CreateIndex
CREATE INDEX "policy_list_index_outstandingBalance_idx" ON "policy_list_index"("outstandingBalance");

-- CreateIndex
CREATE INDEX "policy_list_index_invoiceOverdue_idx" ON "policy_list_index"("invoiceOverdue");

-- CreateIndex
CREATE INDEX "policy_list_index_cancellationPending_idx" ON "policy_list_index"("cancellationPending");

-- CreateIndex
CREATE INDEX "policy_list_index_hasOpenClaim_idx" ON "policy_list_index"("hasOpenClaim");

-- CreateIndex
CREATE INDEX "policy_list_index_customerActionRequired_idx" ON "policy_list_index"("customerActionRequired");

-- CreateIndex
CREATE INDEX "policy_list_index_uwActionRequired_idx" ON "policy_list_index"("uwActionRequired");

-- CreateIndex
CREATE INDEX "policy_list_index_complianceState_idx" ON "policy_list_index"("complianceState");

-- CreateIndex
CREATE INDEX "policy_list_index_bo_status_bo_status_changed_at_idx" ON "policy_list_index"("bo_status", "bo_status_changed_at");

-- CreateIndex
CREATE INDEX "program_rating_models_programId_status_idx" ON "program_rating_models"("programId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "program_rating_models_programId_version_key" ON "program_rating_models"("programId", "version");

-- CreateIndex
CREATE INDEX "invoices_policyId_idx" ON "invoices"("policyId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "payments_policyId_idx" ON "payments"("policyId");

-- CreateIndex
CREATE INDEX "payments_policyId_provider_idempotencyKey_createdAt_idx" ON "payments"("policyId", "provider", "idempotencyKey", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "payments_policyId_provider_status_createdAt_idx" ON "payments"("policyId", "provider", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "payments_checkoutId_idx" ON "payments"("checkoutId");

-- CreateIndex
CREATE INDEX "payments_paymentId_idx" ON "payments"("paymentId");

-- CreateIndex
CREATE INDEX "payments_riskTransactionId_idx" ON "payments"("riskTransactionId");

-- CreateIndex
CREATE INDEX "payments_idempotencyKey_idx" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_events_paymentId_idx" ON "payment_events"("paymentId");

-- CreateIndex
CREATE INDEX "payment_events_paymentId_eventType_receivedAt_idx" ON "payment_events"("paymentId", "eventType", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "payment_events_providerEventId_idx" ON "payment_events"("providerEventId");

-- CreateIndex
CREATE INDEX "documents_policyId_idx" ON "documents"("policyId");

-- CreateIndex
CREATE INDEX "documents_policyId_docPack_status_type_version_idx" ON "documents"("policyId", "docPack", "status", "type", "version" DESC);

-- CreateIndex
CREATE INDEX "documents_riskTransactionId_idx" ON "documents"("riskTransactionId");

-- CreateIndex
CREATE INDEX "document_sets_policyId_idx" ON "document_sets"("policyId");

-- CreateIndex
CREATE INDEX "document_sets_transactionId_idx" ON "document_sets"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_eventId_key" ON "outbox"("eventId");

-- CreateIndex
CREATE INDEX "outbox_processed_idx" ON "outbox"("processed");

-- CreateIndex
CREATE INDEX "outbox_processed_createdAt_idx" ON "outbox"("processed", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_eventId_idx" ON "outbox"("eventId");

-- CreateIndex
CREATE INDEX "outbox_idempotencyKey_idx" ON "outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "sanction_screening_runs_policyId_executedAt_idx" ON "sanction_screening_runs"("policyId", "executedAt" DESC);

-- CreateIndex
CREATE INDEX "sanction_screening_runs_quoteSessionId_executedAt_idx" ON "sanction_screening_runs"("quoteSessionId", "executedAt" DESC);

-- CreateIndex
CREATE INDEX "sanction_screening_runs_providerSearchId_idx" ON "sanction_screening_runs"("providerSearchId");

-- CreateIndex
CREATE INDEX "sanction_screening_runs_outcome_idx" ON "sanction_screening_runs"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "sanction_screening_runs_provider_policyId_actionType_idempo_key" ON "sanction_screening_runs"("provider", "policyId", "actionType", "idempotencyKey");

-- CreateIndex
CREATE INDEX "compliance_decisions_screeningRunId_decidedAt_idx" ON "compliance_decisions"("screeningRunId", "decidedAt" DESC);

-- CreateIndex
CREATE INDEX "compliance_decisions_decision_reasonCode_idx" ON "compliance_decisions"("decision", "reasonCode");

-- CreateIndex
CREATE INDEX "event_processing_log_processedAt_idx" ON "event_processing_log"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "claims_claimNumber_key" ON "claims"("claimNumber");

-- CreateIndex
CREATE INDEX "claims_policyId_idx" ON "claims"("policyId");

-- CreateIndex
CREATE INDEX "claims_status_idx" ON "claims"("status");

-- CreateIndex
CREATE INDEX "claim_events_claimId_occurredAt_idx" ON "claim_events"("claimId", "occurredAt");

-- CreateIndex
CREATE INDEX "claim_events_eventType_idx" ON "claim_events"("eventType");

-- CreateIndex
CREATE INDEX "claim_events_aggregateId_aggregateVersion_idx" ON "claim_events"("aggregateId", "aggregateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "claim_events_claimId_idempotencyKey_key" ON "claim_events"("claimId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "claim_projection_snapshots_claimId_asOf_idx" ON "claim_projection_snapshots"("claimId", "asOf");

-- CreateIndex
CREATE INDEX "claim_pros_role_idx" ON "claim_pros"("role");

-- CreateIndex
CREATE INDEX "claim_pros_name_idx" ON "claim_pros"("name");

-- CreateIndex
CREATE INDEX "claim_assignments_claimId_idx" ON "claim_assignments"("claimId");

-- CreateIndex
CREATE INDEX "claim_assignments_proId_idx" ON "claim_assignments"("proId");

-- CreateIndex
CREATE INDEX "claim_assignments_status_idx" ON "claim_assignments"("status");

-- CreateIndex
CREATE INDEX "claim_reserve_transactions_claimId_idx" ON "claim_reserve_transactions"("claimId");

-- CreateIndex
CREATE INDEX "claim_reserve_transactions_type_idx" ON "claim_reserve_transactions"("type");

-- CreateIndex
CREATE INDEX "claim_reserve_transactions_occurredAt_idx" ON "claim_reserve_transactions"("occurredAt");

-- CreateIndex
CREATE INDEX "claim_info_requests_claimId_idx" ON "claim_info_requests"("claimId");

-- CreateIndex
CREATE INDEX "claim_info_requests_status_idx" ON "claim_info_requests"("status");

-- CreateIndex
CREATE INDEX "reconciliations_invoiceId_idx" ON "reconciliations"("invoiceId");

-- CreateIndex
CREATE INDEX "reconciliations_policyId_idx" ON "reconciliations"("policyId");

-- CreateIndex
CREATE INDEX "reconciliations_paymentId_idx" ON "reconciliations"("paymentId");

-- CreateIndex
CREATE INDEX "reconciliations_status_idx" ON "reconciliations"("status");

-- CreateIndex
CREATE INDEX "binder_documents_binderId_idx" ON "binder_documents"("binderId");

-- CreateIndex
CREATE INDEX "binder_documents_type_idx" ON "binder_documents"("type");

-- CreateIndex
CREATE INDEX "binder_parties_binderId_idx" ON "binder_parties"("binderId");

-- CreateIndex
CREATE INDEX "binder_parties_role_idx" ON "binder_parties"("role");

-- CreateIndex
CREATE INDEX "binder_coverages_binderId_idx" ON "binder_coverages"("binderId");

-- CreateIndex
CREATE INDEX "binder_coverages_coverageCode_idx" ON "binder_coverages"("coverageCode");

-- CreateIndex
CREATE INDEX "binder_clauses_binderId_idx" ON "binder_clauses"("binderId");

-- CreateIndex
CREATE INDEX "binder_clauses_clauseType_idx" ON "binder_clauses"("clauseType");

-- CreateIndex
CREATE INDEX "program_binder_links_programId_idx" ON "program_binder_links"("programId");

-- CreateIndex
CREATE INDEX "program_binder_links_binderId_idx" ON "program_binder_links"("binderId");

-- CreateIndex
CREATE UNIQUE INDEX "program_binder_links_programId_binderId_key" ON "program_binder_links"("programId", "binderId");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_periods_binderId_year_month_key" ON "reporting_periods"("binderId", "year", "month");

-- CreateIndex
CREATE INDEX "risk_transactions_policyId_idx" ON "risk_transactions"("policyId");

-- CreateIndex
CREATE INDEX "risk_transactions_policyId_transactionType_status_transacti_idx" ON "risk_transactions"("policyId", "transactionType", "status", "transactionNumber" DESC);

-- CreateIndex
CREATE INDEX "risk_transactions_programId_idx" ON "risk_transactions"("programId");

-- CreateIndex
CREATE INDEX "risk_transactions_binderId_idx" ON "risk_transactions"("binderId");

-- CreateIndex
CREATE INDEX "risk_transactions_reportingPeriodId_idx" ON "risk_transactions"("reportingPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "risk_transactions_policyId_transactionNumber_key" ON "risk_transactions"("policyId", "transactionNumber");

-- CreateIndex
CREATE INDEX "premium_transactions_riskTransactionId_idx" ON "premium_transactions"("riskTransactionId");

-- CreateIndex
CREATE INDEX "tax_lines_premiumTransactionId_idx" ON "tax_lines"("premiumTransactionId");

-- CreateIndex
CREATE INDEX "report_rows_runId_idx" ON "report_rows"("runId");

-- CreateIndex
CREATE INDEX "audit_actions_entityId_entityType_idx" ON "audit_actions"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "audit_actions_occurredAt_idx" ON "audit_actions"("occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "endorsement_templates_mbe_programCode_code_version_key" ON "endorsement_templates_mbe"("programCode", "code", "version");

-- CreateIndex
CREATE INDEX "endorsement_instances_mbe_policyId_idx" ON "endorsement_instances_mbe"("policyId");

-- CreateIndex
CREATE INDEX "endorsement_instances_mbe_transactionId_idx" ON "endorsement_instances_mbe"("transactionId");

-- CreateIndex
CREATE INDEX "communication_threads_entityType_entityId_idx" ON "communication_threads"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "communication_messages_threadId_idx" ON "communication_messages"("threadId");

-- CreateIndex
CREATE INDEX "communication_messages_channel_idx" ON "communication_messages"("channel");

-- CreateIndex
CREATE INDEX "communication_messages_status_idx" ON "communication_messages"("status");

-- CreateIndex
CREATE INDEX "communication_messages_communicationType_idx" ON "communication_messages"("communicationType");

-- CreateIndex
CREATE INDEX "communication_messages_idempotencyKey_idx" ON "communication_messages"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "communication_messages_threadId_idempotencyKey_key" ON "communication_messages"("threadId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "communication_participants_entityType_entityId_idx" ON "communication_participants"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "communication_participants_email_idx" ON "communication_participants"("email");

-- CreateIndex
CREATE INDEX "communication_delivery_attempts_messageId_idx" ON "communication_delivery_attempts"("messageId");

-- CreateIndex
CREATE INDEX "communication_delivery_attempts_status_idx" ON "communication_delivery_attempts"("status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_primaryAccountId_fkey" FOREIGN KEY ("primaryAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "access_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "access_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_users" ADD CONSTRAINT "account_users_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_users" ADD CONSTRAINT "account_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_otps" ADD CONSTRAINT "user_otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_insuredEntityId_fkey" FOREIGN KEY ("insuredEntityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_policyHolderId_fkey" FOREIGN KEY ("policyHolderId") REFERENCES "policy_holders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_email_states" ADD CONSTRAINT "renewal_email_states_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_vectors" ADD CONSTRAINT "policy_vectors_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_quote_history" ADD CONSTRAINT "policy_quote_history_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_state_current" ADD CONSTRAINT "policy_state_current_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_search_index" ADD CONSTRAINT "policy_search_index_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_list_index" ADD CONSTRAINT "policy_list_index_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_rating_models" ADD CONSTRAINT "program_rating_models_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_riskTransactionId_fkey" FOREIGN KEY ("riskTransactionId") REFERENCES "risk_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_riskTransactionId_fkey" FOREIGN KEY ("riskTransactionId") REFERENCES "risk_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sets" ADD CONSTRAINT "document_sets_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sets" ADD CONSTRAINT "document_sets_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "risk_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sets" ADD CONSTRAINT "document_sets_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "document_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanction_screening_runs" ADD CONSTRAINT "sanction_screening_runs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_decisions" ADD CONSTRAINT "compliance_decisions_screeningRunId_fkey" FOREIGN KEY ("screeningRunId") REFERENCES "sanction_screening_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_projection_snapshots" ADD CONSTRAINT "claim_projection_snapshots_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_assignments" ADD CONSTRAINT "claim_assignments_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_assignments" ADD CONSTRAINT "claim_assignments_proId_fkey" FOREIGN KEY ("proId") REFERENCES "claim_pros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_reserve_transactions" ADD CONSTRAINT "claim_reserve_transactions_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_info_requests" ADD CONSTRAINT "claim_info_requests_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_documents" ADD CONSTRAINT "binder_documents_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_parties" ADD CONSTRAINT "binder_parties_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_coverages" ADD CONSTRAINT "binder_coverages_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_coverages" ADD CONSTRAINT "binder_coverages_wordingAnchorClauseId_fkey" FOREIGN KEY ("wordingAnchorClauseId") REFERENCES "binder_clauses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_clauses" ADD CONSTRAINT "binder_clauses_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_financials" ADD CONSTRAINT "binder_financials_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_reporting" ADD CONSTRAINT "binder_reporting_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_binder_links" ADD CONSTRAINT "program_binder_links_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_binder_links" ADD CONSTRAINT "program_binder_links_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_periods" ADD CONSTRAINT "reporting_periods_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_transactions" ADD CONSTRAINT "risk_transactions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_transactions" ADD CONSTRAINT "risk_transactions_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_transactions" ADD CONSTRAINT "risk_transactions_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "binders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_transactions" ADD CONSTRAINT "risk_transactions_reportingPeriodId_fkey" FOREIGN KEY ("reportingPeriodId") REFERENCES "reporting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_transactions" ADD CONSTRAINT "premium_transactions_riskTransactionId_fkey" FOREIGN KEY ("riskTransactionId") REFERENCES "risk_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_lines" ADD CONSTRAINT "tax_lines_premiumTransactionId_fkey" FOREIGN KEY ("premiumTransactionId") REFERENCES "premium_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magicb_rules" ADD CONSTRAINT "magicb_rules_slug_fkey" FOREIGN KEY ("slug") REFERENCES "magicb_slugs"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magicb_mappings" ADD CONSTRAINT "magicb_mappings_slug_fkey" FOREIGN KEY ("slug") REFERENCES "magicb_slugs"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_reportingPeriodId_fkey" FOREIGN KEY ("reportingPeriodId") REFERENCES "reporting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_rows" ADD CONSTRAINT "report_rows_runId_fkey" FOREIGN KEY ("runId") REFERENCES "report_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsement_instances_mbe" ADD CONSTRAINT "endorsement_instances_mbe_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsement_instances_mbe" ADD CONSTRAINT "endorsement_instances_mbe_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "risk_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsement_instances_mbe" ADD CONSTRAINT "endorsement_instances_mbe_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "endorsement_templates_mbe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "communication_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_delivery_attempts" ADD CONSTRAINT "communication_delivery_attempts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

