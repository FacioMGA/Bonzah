# Insurance Studio: first training product

Open **Facio Platform → customer workspace → Studio** and build a fictional product that charges **GBP 100.00** for one risk, refers risks with more than 50 employees, and retains an exact quote and binding history. Use your own authorized sandbox tenant. Everything below is synthetic training: no customer data, approved insurance rates, actual coverage, provider verification or payment is involved.

Steps 1–5 create the original **v1 single-risk training product**. The later Sprint 5 section explains the additional workflows for an explicitly configured **v2 product**; it does not upgrade this example or its retained records. The September 7 [serving-build receipt](../deployment/evidence/2026-09-07-sprint5-final-public.json) and [real administrator browser receipt](../deployment/evidence/2026-09-07-sprint5-final-browser.json) identify the verified sandbox release and bounded synthetic observations. Independent intern completion, an actual second reviewer, ChatGPT acceptance and customer acceptance remain open. See the [full Sprint 5 scope and remaining gates](../delivery/sprint-5-implementation.md).

## 1. Create your tenant and attach the training requirements

1. Open [Facio Platform](https://platform.facio.io) and select **Sign in with Facio**. Use your organization identity. Select an account/customer workspace you are authorized to use; account membership and tenant access are assigned by the server.
2. Select **Create sandbox tenant**, enter a **Sandbox display name** such as `Amit — insurance training`, and select **Create tenant**. The **Deployed region** is supplied by the server. Use your own name; display names do not grant permissions.
3. Select **Open Studio**, then **Sandbox setup**. Bookmark the resulting `/studio?tenant=<your tenant UUID>` URL. Under **Tenant identity and provisioning**, copy the **Operating entity** identifier. It is different from the tenant UUID and must be used in the configuration below.
4. Download [insurance-training-requirements.json](insurance-training-requirements.json). Under **1. Attach source requirements**, select **Import package** → **Read a requirements package file**, choose that JSON file, review the populated **Requirements package JSON**, and select **Attach package**.

The file is reusable across training tenants and contains only fictional requirements plus an inline synthetic source. It contains no credentials, tenant identifiers or customer sources. Import attaches requirements; it does not create product configuration. **Source document claims: unverified** is expected. **Ready** infrastructure and an attached package do not mean the insurance journey has passed.

If no account or tenant is available, an account administrator must assign access. A viewer can inspect but cannot perform the authoring steps. Use the application's **Retry provisioning** control only when a failed provisioning operation presents it.

## 2. Save the tenant, entity and process base

For a newly created, empty training tenant, open **Tenant definition** → **Definition JSON**, with **Draft** selected. This editor replaces the **whole configuration**, so use this template only before creating your product. In an existing populated tenant, preserve the existing configuration and edit only the intended values.

Replace `REPLACE_WITH_YOUR_OPERATING_ENTITY_ID` with the exact **Operating entity** copied from your own **Sandbox setup**. Paste the complete object and select **Save draft**:

```json
{
  "tenant": {
    "displayName": "My insurance training",
    "locale": "en-GB",
    "currency": "GBP",
    "timeZone": "UTC",
    "residency": "eu"
  },
  "operatingEntities": [
    {
      "id": "REPLACE_WITH_YOUR_OPERATING_ENTITY_ID",
      "name": "Training entity",
      "territories": ["GB"]
    }
  ],
  "products": [],
  "processes": [
    {
      "id": "training-process",
      "version": "1.0.0",
      "name": "Training process",
      "initialStage": "review",
      "stages": [{ "id": "review", "label": "Review", "terminal": true }],
      "transitions": []
    }
  ],
  "integrations": []
}
```

`residency` is definition metadata; it does not move the deployed environment. GB is the fictional risk territory and grants no licence or authority. The process is a valid configuration reference; its stage does not itself execute a workflow. Entity/process authoring currently uses this JSON editor; the product below uses structured controls.

## 3. Author the product through structured controls

Open **Product definitions** → **Insurance products** → **Create insurance product**. Work through the section tabs; do not save until all required sections are filled. Enter money as decimal currency amounts **without thousands separators**.

### Product

| Field                     | Training value                                                                  |
| ------------------------- | ------------------------------------------------------------------------------- |
| Product identifier        | `configured-cover`                                                              |
| Product version           | `1.0.0`                                                                         |
| Product name              | `Training property cover`                                                       |
| Operating entity          | Select your `Training entity` and verify its identifier                         |
| Process definition        | `Training process · 1.0.0`                                                      |
| Required capabilities     | Enter `insurance_decisions`, `coverage_rating`, and `exact_money`, one per line |
| Eligible country codes    | `GB`                                                                            |
| Product source references | `fixture://training-only`                                                       |
| Minimum term (days)       | `1`                                                                             |
| Maximum term (days)       | `366`                                                                           |
| Backdating policy         | **Not permitted**                                                               |

Terms count inclusive UTC calendar days: the same start/end date is one day. The source references throughout this exercise are fictional labels, not verified documents or approvals.

### Risk questions

Select **Add risk question**. Set identifier `employees`, label `Employees`, description `Number of people employed at the fictional risk.`, and source reference `fixture://training-only#employees`. Select **Answer type: Integer**, set **Minimum value** to `0` and **Maximum value** to `1000`, and keep **Answer required** checked.

### Coverages

Select **Add coverage** and enter:

| Field                                                             | Training value                                  |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| Coverage identifier / Coverage name                               | `buildings` / `Buildings`                       |
| Coverage description                                              | `Fictional material damage coverage.`           |
| Source references                                                 | `fixture://training-only#buildings`             |
| Limit and deductible basis                                        | **Single risk, per occurrence**                 |
| Coverage required                                                 | Checked                                         |
| Requires coverage identifiers / Incompatible coverage identifiers | Leave unselected; this example has one coverage |
| Minimum selected limit (GBP)                                      | `1000.00`                                       |
| Maximum selected limit (GBP)                                      | `1000000.00`                                    |
| Minimum deductible (GBP)                                          | `0.00`                                          |
| Maximum deductible (GBP)                                          | `10000.00`                                      |
| Pricing method                                                    | **Flat amount**                                 |
| Flat premium (GBP)                                                | `100.00`                                        |

This **v1 example** uses fixed currency amounts for one risk per occurrence. It does not configure aggregates, per-person limits or excess attachments; the separate v2 model supports explicitly defined versions of those features. Neither this example nor the v2 workflow calculates claim payments, and this example uses a fixed currency deductible, not a percentage.

### Eligibility & referrals

Select **Add decision rule** and configure:

| Field                 | Training value                                              |
| --------------------- | ----------------------------------------------------------- |
| Rule identifier       | `employee-referral`                                         |
| Matched outcome       | **Refer for underwriting**                                  |
| Business reason       | `Risks with more than 50 employees require an underwriter.` |
| Source references     | `fixture://training-only#referral`                          |
| Match condition group | **All conditions must match**                               |
| Risk question         | `Employees · employees`                                     |
| Condition             | **is greater than**                                         |
| Comparison value      | `50`                                                        |

### Rating factors and Authority

Under **Rating factors**, set **Minimum whole-term premium (GBP)** to `25.00`. Do not add a factor for this example. The flat premium of GBP 100 is above the floor.

Under **Authority**, set **Maximum premium within authority (GBP)** to `1000.00`, **Maximum sum of selected limits (GBP)** to `1000000.00`, and **Authority source references** to `fixture://training-only#authority`. These fictional numeric checks are separate from real delegated authority or carrier approval.

Select **Save product definition**. Check the success notification and retained product. This saves the draft; the product becomes executable only after the next two steps.

## 4. Add its operating policy and activate

Return to **Sandbox setup** → **Add executable policy**. This policy supplies operating dates, caps, commission and prerequisites. The structured product supplies the risk rules and GBP 100 rate.

| Field                                                   | Training value                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| Defined product version                                 | `Training property cover · 1.0.0`                                    |
| Policy display name                                     | `Training operating policy`                                          |
| Policy currency                                         | `GBP`, matching the tenant configuration                             |
| Maximum premium amount                                  | `1000.00`                                                            |
| Policy effective from                                   | Today's UTC date                                                     |
| Policy effective through                                | A date at least one year from today, covering the entire test term   |
| Maximum participant count                               | `10`                                                                 |
| Commission rate (%)                                     | `7.00` — fictional training percentage                               |
| Commission recipient identifier                         | `synthetic-broker`                                                   |
| Settlement party identifier                             | `synthetic-settlement`                                               |
| Payment / Approval / Provider verification prerequisite | For each, explicitly select **Not required for this sandbox policy** |

Select **Save executable policy draft**. Under **3. Validate and activate**, resolve the listed blockers, select **Review activation**, inspect the exact configuration/policy/requirements references, then select **Activate sandbox release**. Record the active release ID. Use **Draft** for continued authoring and inspect the exact active release in **Sandbox setup** for runtime evidence. Saving a later draft does not change a retained quote or its original definition.

Do not change a real requirement to “not required” to bypass a blocker. Those selections are appropriate only for this wholly fictional training policy. A matching referral rule still blocks binding even though the operating policy itself does not require routine approval. An eligible exact-pinned independent human review may resolve that referral gate; it cannot override other failing gates.

## 5. Evaluate the two risks, then retain and bind the eligible one

Open **Insurance workspace** → **New quote**. The heading should be **Evaluate a configured risk** with your registered product selected. Fill:

| Field                                       | Training value                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Risk description                            | `Fictional office building`                                                               |
| Submission reference / Submission version   | `training-001` / `1`                                                                      |
| Risk territory                              | `GB`                                                                                      |
| Term start                                  | Tomorrow's UTC date                                                                       |
| Term end                                    | Six days after the start: seven inclusive days                                            |
| Quote expires at (UTC)                      | A future UTC date/time before the term ends; for example three days from today at `12:00` |
| Submission evidence references              | `fixture://training-only#risk`                                                            |
| Employees                                   | `60` for the referral preview first                                                       |
| Buildings                                   | Select the required coverage                                                              |
| Limit (GBP) / Deductible (GBP)              | `100000.00` / `500.00`                                                                    |
| Participant 1 identifier / role / share (%) | `synthetic-lead` / `Lead` / `100.00`                                                      |

Use current dates, not dates copied from an old screenshot. The operating window must cover the term, the quote must be unexpired, and the term start must not be before the evaluation's UTC date.

1. Select **Evaluate risk** with `60` employees. Expect premium **GBP 100.00**, the `employee-referral` finding, **Referral: Required**, **Approval: Required · unresolved in evaluator**, and **Binding blocked**. A priced referral remains blocked. Evaluation alone creates no insurance record; do not retain this preview for the exercise.
2. Change Employees to `10`. The previous preview clears. Select **Evaluate risk** again. Expect valid/applicable inputs, eligible status, referral not required, rating calculated at **GBP 100.00**, authority within authority, approval not required, and **Bind checks passed**.
3. Select **Retain evaluated quote**. Inspect **current revision 1**, quoted status, the selected coverage/submission in the expandable trace, and the pinned release. The premium is derived by the server; the form does not ask you to supply it.
4. Select **Bind selected quote**. Expect **current revision 2** and bound status. Gross participant allocation is **GBP 100.00** to the lead; the separate synthetic commission is **GBP 7.00** with external cash custody. These calculations do not collect premium or post a payment.
5. Inspect **Immutable version history** for the quoted and bound revisions, then refresh and reopen the record. Record your tenant, active release, record ID and decision hash as your own training evidence.

For an additional validation exercise, start a separate new form and leave Employees blank or Buildings unselected, then select **Evaluate risk**. Expect invalid inputs and blocked binding. Correcting an input requires a fresh evaluation. Use a new submission reference, such as `training-002`, if you later retain another quote.

## Optional: independently review a referred training quote

This exercise requires a different authorized administrator with access to the same tenant. The local browser test uses separate synthetic identities; it does not prove that two actual people have completed a hosted review. If an independent reviewer is unavailable, retain the pending result rather than share a login or change the fictional risk to bypass the referral.

1. Create a **New quote** with a new submission reference such as `training-review-001`, current dates, and `60` Employees. **Evaluate risk**, then **Retain evaluated quote**. Expect a priced but referred quote at GBP 100.00. Keeping this separate from `training-001` preserves the first exercise's history.
2. In **Human review**, inspect the retained risk answers, Buildings cover, selected limit/deductible, terms, rule reason and source references. Select **Request review**. Enter **Review request rationale**, for example `Synthetic exercise: inspect the employee referral for this exact quote`, and **Supporting evidence references** such as `fixture://training-only#review-request`. Set **Review expires at (UTC)** to a future instant no later than both the quote expiry and seven days from now. Select **Submit review request**.
3. The independent administrator opens the same authorized tenant and selected quote. They inspect the pinned submission and definition before deciding. The requester, original record creator and current quote author cannot approve or decline their own record, even if they are administrators. Select **Review request**. In **Decide this review**, enter **Decision rationale** and a fictional evidence reference, then select **Approve pinned quote** or **Decline review**. Approval here records only the stated sandbox decision.
4. If approved, select **Bind selected quote** from an authorized session. The server rechecks the selected quote and exact review. Inspect the bound record's separate human-review evidence and immutable history. **Retained product evaluation · before human review** remains the original automated result; a referral in that trace does not mean it was silently rewritten.

A declined, withdrawn, expired or stale review cannot authorize binding. Only one review request is allowed per quote revision; a new UUID cannot replace an adverse review. An administrator may use **Withdraw review** for an unused review, with a rationale and evidence; this does not cancel a bound policy. Invalid data, decline rules, rating/authority failures, prohibited backdating and payment/provider requirements remain independent blockers. This guide does not establish customer underwriting authority.

## Optional: retain synthetic provider evidence

Before binding a separate retained configured quote, open **Provider activity**. The scoped catalog is authoritative. If it says no adapter is registered, connectivity is unconfigured; entering a source reference or a credential in product metadata does not create an adapter.

When an explicitly registered **Synthetic training adapter** is available, select **Queue training evidence**, then **Refresh activity** to observe processing. Select **Inspect delivery history** to review the pinned quote, attempts and receipt provenance. A queued request is durable intent; only **Evidence received** records an accepted result. The UI offers **Resume due retry** or **Request reconciliation** only for applicable retained work, within the original server limits. A disabled control is not an invitation to create a duplicate request.

The synthetic adapter contacts no insurer and changes no insurance price, record revision, payment or bind authority. The generic server-side HMAC adapter capability is separately tested locally; it does not mean any customer provider, screening service or payment processor has been connected. Do not enter provider secrets in the browser or infer successful delivery from a pending request.

## Sprint 5: operate an explicitly configured v2 training product

Use an authorized tenant with an activated **v2** definition and matching executable policy. The product must explicitly declare its risk groups, question conditions, coverage bases/layers, rating term basis, servicing permissions and any cancellation rule. A requirements attachment alone supplies none of these. The structured v1 exercise above remains valid for quoting, revision and binding; its bound records do **not** gain v2 servicing by activating a different definition later. Maintain an existing v2 definition through **Product definitions** → **Insurance products** → **Edit product**, using the structured risk, condition, coverage and servicing controls. When converting a v1 draft intentionally, choose **Upgrade draft to product v2**. Save the draft, review it and activate the next release separately. The complete-configuration JSON editor remains an optional expert path.

Use only fictional inputs and the rules actually retained by your selected product. For a reproducible arithmetic exercise, an explicitly configured daily product charging GBP 10 primary plus GBP 2 excess per day produces GBP 48 over four inclusive days and GBP 3.36 commission at 7%. These numbers describe the separate synthetic rehearsal configuration, not the GBP 100 whole-term example above or a customer rate.

### Enter repeated risks and revise an unbound quote

1. Select **New quote** and the registered v2 product. Fill the policy-level questions, then use **Add [risk-group label]** to add each fictional risk row. Complete each row's questions and scoped coverages. **Remove row** removes that row from the proposed submission; retained row identifiers preserve its identity across revisions.
2. Conditional questions appear or disappear as answers change. A visible question can become required. Hidden answers can remain in the unsaved form if you toggle back, but are excluded from the effective submission. Check **Evaluate risk** findings before retaining; missing or unknown answers never imply eligibility.
3. Under **Coverage selection**, enter the displayed currency limits and deductibles, plus **Aggregate · [basis]** and **Excess attachment** only where the definition supplies them. An excess attachment is separate from a deductible. The server checks scope, dependencies, incompatible covers, allowed bases and layer continuity. Review the pricing trace's whole-term or daily basis, authority findings and exact source references.
4. **Retain evaluated quote** keeps the exact result. To change a still-quoted record, select **Revise quote**. Keep its source reference and use a new **Submission version**; evaluate again, compare the previous retained evidence, then **Retain evaluated quote**. The original product definition stays pinned. Earlier revisions remain in **Immutable version history**; old reviews cannot authorize a changed quote. This revision path also supports configured v1 quotes.

### Change the configured risk or term

From a bound v2 record, select **Change risk or term**. In **Change configured risk or term**, update the permitted risk/coverage inputs or extend the term, retain the submission reference, and enter a new submission version, **Change effective date**, **Reason for change** and evidence references. Select **Preview change**.

Review **Configured change preview**: removed remaining premium, added remaining premium, **Premium movement** and **New cumulative premium**. Select **Record configured change** only when the server reports the change allowed. The original quote remains unchanged; the new contractual revision retains its effective exposure and financial total. A future-effective revision is a recorded schedule, not evidence that changed cover is already in force today.

The retained definition must permit the requested change. Effective dates must be current/future, within the existing term and no earlier than the latest retained effective date. Inception, territory and capacity participants remain fixed. Daily pricing can support an explicitly permitted extension; whole-term actual-days proration supports an unchanged term. Applied minimum premiums and unsupported service approval/payment/provider requirements block the change. A prior bind review is not service authority. Term shortening uses no implicit return rule.

### Prepare a separate renewal, then preview cancellation separately

For a renewal exercise, keep a bound configured source available: **Prepare renewal quote** is unavailable on a cancelled source. Select it, choose a registered version of the same product identity, enter a **new Submission reference**, fresh evidence and expiry, and a new term starting after the source's latest contractual term. Review updated risks and covers, then select **Compare and evaluate renewal** → **Retain distinct renewal quote**. Inspect the comparison and source linkage. This creates a separate quoted record; evaluate its current gates and bind it separately. It inherits no prior approval or provider verification, and does not rewrite or automatically renew the source.

For cancellation, select the intended bound v2 source → **Cancel with configured return**. Enter **Cancellation effective date**, **Reason for cancellation** and **Cancellation evidence references**, then **Preview cancellation**. Inspect the supported calculation, return premium, retained cumulative premium and any blockers before **Record configured cancellation**. The retained product needs an explicit cancellation rule; applied minimums or unsupported prerequisites remain blocked. Cancellation cannot precede the latest retained effective date and must be current/future, no later than the day after the term ends. A future-effective cancelled status records scheduled cessation. It does not execute a refund or deliver a cancellation notice.

### Generate and inspect synthetic transaction documents

On the intended bound/service/cancellation/renewal record revision, open **Transaction documents** → **Generate training pack**. A registered training pack must be available. Use **Refresh documents** until the retained attempt reports completion, then **Inspect document history**, **Download PDF** or **Download HTML**. Use **Retry generation** only when offered for a failed attempt; an uncertain result calls for inspection before another request.

Check the document's synthetic label, policy revision, effective dates, current premium and separate commission against the selected record. Each pack retains its exact transaction snapshot, template version and content hashes. A later service pack does not replace the original bound pack. These templates are training summaries/schedules; they are not customer-approved wording, a legal signature, a sent notice or evidence of insurer acceptance. The [download verification](../deployment/evidence/2026-09-07-sprint5-downloads.json) records the PDF/CSV checks actually performed.

### Review finance and a dated report

Builders with the assigned read permissions can inspect **Transaction finance**, journal history and reports. **Recognize insurance transactions**, **Record training receipt**, **Apply to commission** and **Reverse application** require the server-assigned finance mutation permissions, currently held by account owners/administrators. Do not switch identities or change roles to work around a disabled action.

An authorized administrator first selects **Recognize insurance transactions** and reviews the retained unposted revisions before **Record financial evidence**. For the separate synthetic receipt exercise, use **Record training receipt**, supply the actual fictional exercise's immutable source reference, retained settlement party, UTC receipt timestamp, amount, reason and evidence, then **Record financial evidence**. **Apply to commission** records an allowed amount against the outstanding commission; **Reverse application** reverses that exact application with a reason. Inspect **Immutable journal history** and **Download journal CSV**. External premium control is a memorandum, not Facio client cash. None of these actions moves money or clears a payment prerequisite.

Under **Reconciled view at a date**, set **Effective through** and **Recorded through (UTC)**. Leave the portfolio checkbox clear for the selected record, or select **Include all authorized records in this tenant and operating entity** for a scoped portfolio. Select **Build dated report**, inspect **Capacity control totals** and **Drilldown to exact source transactions**, then **Download dated report CSV**. Verify the selected historical revision, unposted items, separate currency totals and both cutoffs. A future-effective change must not silently become today's exposure. This generic CSV is not an accepted customer BDX, regulatory return or bank reconciliation.

### Retain a loss notice against the historical policy

Open **Loss notice intake** → **New loss notice**. Choose the exact **Historical policy revision** and an explicitly registered **Registered intake destination**. The source policy may now have later service/cancellation revisions; inspect the selected historical term rather than assume its current status resolves coverage.

Enter a stable **Source notice reference**, fictional insured/reporter/preparer facts, **Loss timestamp with UTC offset**, **Source timezone interpretation**, location, narrative, reported injury status and necessary evidence references. The declared preparer is separate from the signed-in actor recorded by the server. Use **Save notice draft**, then **Inspect loss notice** or **Resume draft** to complete it. Review the displayed policy term comparison and flags; a loss outside that term is a review flag, not a coverage decision. A future loss timestamp blocks submission.

When complete, select **Review submission**. If possible duplicates are reported, record the **Duplicate disposition** and **Duplicate review rationale** without overwriting either notice. Select **Submit retained notice**, then **Acknowledge in training queue** when available. Inspect **Immutable intake history** and the pinned policy/receipt evidence. Submission freezes the reported facts; the registered internal queue receipt establishes no external handoff. Public expiring links, legal signatures, carrier delivery, claim adjudication and payment remain outside this training flow.

The [Sprint 5 implementation matrix](../delivery/sprint-5-implementation.md) preserves all remaining customer package, provider, document/legal, servicing, finance/BDX, independent-user and reset/rehearsal gates. M3 remains September 8; the implementation/rehearsal target is September 9; Bonzah and UE demos remain September 10, full VUW remains September 11, and M4 remains September 12. Following this guide is synthetic operator evidence, not acceptance of those milestones.

## Recover from an incomplete step

- **Activation blocked:** read the specific blockers. Common causes are the wrong operating entity ID, a missing process/product policy, currency mismatch, unsupported required capabilities or incomplete fields. Save the correction and review the new exact candidate.
- **Date/expiry failure:** choose current permitted dates and evaluate again. Do not override the backdating rule.
- **Stale version/hash or uncertain request:** follow the displayed retry/refresh instruction and inspect the retained result before making another change. Refresh may discard unsaved form edits.
- **Referral:** inspect the rule and source explanation. Follow **Human review** only where the server offers the supported independent review path. Preserve the blocked result when the required reviewer, valid review or another prerequisite is missing.
- **Revision or servicing disabled:** **Revise quote** applies only while the record is quoted. **Change risk or term** and **Cancel with configured return** require a bound configured v2 record and its retained supported rules; the v1 product above cannot use those service paths. Review status, permissions and server blockers. Activating a newer definition does not upgrade an old record. This guide provides no reset feature.

Keep the observed result honest: **infrastructure ready**, **configuration activated**, and **this synthetic scenario observed** are separate evidence. None records customer acceptance or creates a production insurance policy.
