# Domain Events Architecture Audit

Below is a detailed review of the major domain events implemented across the Abbeygate platform, evaluated against the requested A-J 10-point checklist. 

Events have been logically grouped into major business bounded contexts.

---

## 1. Claims Intake & Triage
**Events:** `FNOL_SUBMITTED`, `FNOL_SUBMITTED_BY_CUSTOMER`, `CLAIM_OPENED`, `DEDUCTIBLE_LOCKED`, `CLAIM_DENIED`, `REFERRAL_REQUIRED`

**A. Identity:** Aggregate: `CLAIM`. Parent link: `POLICY`.
**B. Business semantics:** Highly specific and meaningful. `FNOL_SUBMITTED_BY_CUSTOMER` distinctly separates actor context natively at the event name level.
**C. State delta:** State transitions from Unverified (FNOL) → Verified (Open) → Closed/Denied. Deductible locks transition the claim from flexible to financially rigid.
**D. Actor:** Customer, Underwriter, External Adjuster.
**E. Reason:** Direct manual input or authority rule hits (e.g., `REFERRAL_REQUIRED` triggers when a threshold rule is hit).
**F. Context:** Jurisdiction bounds apply (often driving referral logic depending on location codes).
**G. Financial dimension:** Indirect exposure changes. `DEDUCTIBLE_LOCKED` sets exactly how much of the payout is covered by the insured.
**H. Operational dimension:** Huge operational impact. `CLAIM_OPENED` sets assignee and starts SLA aging clocks. `REFERRAL_REQUIRED` halts workflow.
**I. Decision dimension:** `CLAIM_DENIED` is a hard decline/block. `REFERRAL_REQUIRED` is an escalation.
**J. Learnability:** **High**. A model trained on `FNOL_SUBMITTED` vs `CLAIM_DENIED` can easily detect early markers of fraudulent intake.

**Verdict:** 🟢 **Healthy**. No changes needed.

---

## 2. Claims Financials
**Events:** `RESERVE_SET`, `RESERVE_ADJ`, `PAYMENT_ADDED`, `RECOVERY_EXPECTED`, `RECOVERY_RECEIVED`, `LARGE_LOSS_FLAGGED`

**A. Identity:** Aggregate: `CLAIM` (Financial Worksheet). Parent link: `CLAIM`, `POLICY`.
**B. Business semantics:** Highly granular. Disambiguates a reserve setting from an actual cash outlay (`PAYMENT_ADDED`).
**C. State delta:** Cash movement and ledger entries. (e.g. Old Reserve = $500, New Reserve = $2000).
**D. Actor:** Claims Handler, System (automatic closures).
**E. Reason:** Manual expert assessment or automated rule (like a salvage recovery registering incoming funds).
**F. Context:** Risk segment specific, typically mapped to the line item type (Bodily Injury vs Property Damage).
**G. Financial dimension:** Massive. Entirely drives reserve liability, vendor payables, and subrogation (recoveries).
**H. Operational dimension:** Triggers secondary reviews if `LARGE_LOSS_FLAGGED` is emitted.
**I. Decision dimension:** Payment authorization.
**J. Learnability:** **Very High**. Tracking `RESERVE_SET` followed by multiple `RESERVE_ADJ` acts as a perfect dataset for predicting "Reserve Creep" in new handlers.

**Verdict:** 🟢 **Healthy**. Well-modeled.

---

## 3. Core Policy Lifecycle
**Events:** `POLICY.STATUS_CHANGED`, `RISK_TRANSACTION.STATUS_CHANGED`, `UW.READINESS_CHANGED`

**A. Identity:** Aggregate: `POLICY` & `RISK_TRANSACTION` & `UW_WORKFLOW`. Parent link: `ACCOUNT`.
**B. Business semantics:** **POOR/GENERIC**. "STATUS_CHANGED" lacks narrative. Was the policy issued? Cancelled for non-payment? Renewed? Endorsed?
**C. State delta:** Changes integer/enum states (e.g., Status: 1 → 2), demanding downstream consumers ping the API to understand what ‘2’ means.
**D. Actor:** Underwriters, System (Renewals cron).
**E. Reason:** Hidden inside the payload. Not queryable at the routing tier.
**F. Context:** Tied deeply to Product specs.
**G. Financial dimension:** Ambiguous. If the change was bound/issued, premium is locked. If cancelled, reserve drops.
**H. Operational dimension:** Impacts pending documents.
**I. Decision dimension:** Obfuscated.
**J. Learnability:** **Poor**. Training an ML model on "status changed" is meaningless without explosive joins. 

**🔴 Critique & Remediation:**
`POLICY.STATUS_CHANGED` and `RISK_TRANSACTION.STATUS_CHANGED` violate the principle of semantic events. 
- **Decomposition Required:** These should be broken into explicit facts: `POLICY_BOUND`, `POLICY_ISSUED`, `POLICY_CANCELLED_NON_PAYMENT`, `POLICY_CANCELLED_INSURED_REQUEST`, `ENDORSEMENT_QUOTED`.
- **Method for Refactor:** Update `policyLifecycleCommands.ts` to emit specific events based on the state machine transitions rather than a generic POST hook.

---

## 4. Accounts360 & Projections
**Events:** `POLICY_UPDATED`, `CLAIM_UPDATED`, `INVOICE_OVERDUE`, `PAYMENT_FAILED`, `DOCUMENT_GENERATED`, `ACCOUNTS360.PROJECTION_UPDATE`

**A. Identity:** Aggregate: `ACCOUNT`. 
**B. Business semantics:** Mixed. `INVOICE_OVERDUE` and `PAYMENT_FAILED` are strong. `POLICY_UPDATED` is weak (CRUD terminology). `ACCOUNTS360.PROJECTION_UPDATE` is a technical event, not a business event.
**C. State delta:** Syncing read-models (No new business truth created).
**D. Actor:** System (Projections).
**E. Reason:** Cascading replication of core data to an Elasticsearch/Read replica tier.
**F. Context:** All products.
**G. Financial dimension:** `INVOICE_OVERDUE` heavily drives delinquency workflows.
**H. Operational dimension:** Updates dashboards for operators.
**I. Decision dimension:** None.
**J. Learnability:** N/A for projections. 

**🔴 Critique & Remediation:**
Technical replication events like `ACCOUNTS360.PROJECTION_UPDATE` shouldn't be traveling on the same Domain Event bus as business facts. They risk polluting the audit log. 
- **Recommendation:** Isolate `*.PROJECTION_UPDATE` variants into infrastructure internal events, distinct from pure Domain facts. Avoid `*_UPDATED` (CRUD logic), and replace with intentional actions (e.g., `ACCOUNT_ADDRESS_RELOCATED`).

---

## 5. Communications & Billing 
**Events:** `COMM.OUTBOUND_QUEUED`, `EMAIL.INFO_REQUIRED`, `WELCOME_EMAIL_SENT`, `CAPTURE`, `FAIL`, `REFUND`

**A. Identity:** Aggregate: `COMMUNICATION`, `PAYMENT`. Parent link: `POLICY`.
**B. Business semantics:** Excellent. `CAPTURE`, `FAIL`, and `REFUND` are universally understood financial primitives.
**C. State delta:** Money secured, or email dispatched.
**D. Actor:** Webhooks (Cardcorp), System (Renewals), Billing Admins.
**E. Reason:** Automated processing schedules, Gateway callbacks.
**F. Context:** Payment gateways, Notification schemes.
**G. Financial dimension:** Complete 1-1 mapping to cash flow.
**H. Operational dimension:** Failure to capture (`FAIL`) or `EMAIL.INFO_REQUIRED` puts the policy into a suspended/dunning state, requiring human touch.
**I. Decision dimension:** Gateway approval/decline.
**J. Learnability:** **High**. Correlating `WELCOME_EMAIL_SENT` delivery speeds against future `FAIL` payments can model customer engagement quality.

**Verdict:** 🟢 **Healthy**. High semantic value.
