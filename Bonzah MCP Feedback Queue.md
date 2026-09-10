# Bonzah MCP feedback queue

Prepared 9 September 2026 for workspace **Bonzah demo**. These items have **not** been submitted: the MCP Feedback repair reports a connected project, but Feedback status returns an internal service error and the MCP exposes no feedback-submission command.

## 1. Feedback connection is internally inconsistent

**Observed:** `config_feedback_workspace_repair` reports the workspace Feedback project as connected. An immediate `config_feedback_workspace_status` call returns `INTERNAL_ERROR: Workspace Feedback could not be reached.`

**Expected:** Status should read the repaired connection and a workspace-authorized command should create a feedback item.

**Acceptance:** Repair followed by status succeeds, and the MCP exposes a documented create/submit feedback operation scoped to the selected workspace.

## 2. No MCP path to create binder product authority

**Observed:** The binder editor can create or edit a binder shell, but explicitly states that per-product authority remains separate. No authorized-products or binder-product-authority create tool is exposed.

**Impact:** A new sandbox workspace cannot be completed through MCP alone. Bonzah has no eligible product authority, so its draft rating model cannot be published.

**Acceptance:** Expose a typed, audited MCP operation to create/update sandbox binder product authority, or return an actionable supported workflow and link from the binder/programme errors.

## 3. Automated programme configuration has an unresolvable MCP dependency

**Observed:** A draft rating model can be created. The programme definition refuses to link it because the model is not published. Rating publication requires an eligible binder product authority, which cannot be created through the exposed MCP surface.

**Impact:** MCP can start but cannot complete the documented draft -> read-back -> publish workflow for a new workspace.

**Acceptance:** Once the caller has programme edit/publish permissions, MCP provides a complete ordered workflow for authority, rating and definition publication without requiring an unavailable operation.

## 4. Rental configuration exposes only the generic commercial document vocabulary

**Observed:** The Bonzah definition retains rental questions and coverage configuration, but the hosted programme editor identifies the configurable commercial adapter. Definition validation accepts only the generic commercial schedule as the issued document type; the four required rental certificate types are unavailable.

**Impact:** The hosted programme cannot select CDW, RCLI, SLI and PAI/PEI certificates as its issued pack through MCP.

**Acceptance:** Clarify whether Bonzah should use the configurable adapter or the dedicated RENTAL runtime. Whichever is intended must expose the four rental document types and their immutable source/version selections through the programme editor.

## 5. Draft authoring validates as publication before required dependencies can be linked

**Observed:** Saving a definition invokes publication-level checks for underwriting, coverage, claims contract, product kit, issued-pack documents and a published rating model. The earlier incomplete rental draft exists, but MCP cannot incrementally save the same incomplete state while completing it.

**Impact:** Configuration cannot be built and reviewed in small draft steps even though draft and publication are described as separate stages.

**Acceptance:** Either permit incomplete draft saves with structured readiness issues, or provide a transaction/dry-run command that returns the complete required payload and dependency order before saving.

## Current evidence

- MCP connectivity and workspace permissions: working.
- Rental source questions, coverage sections and eligibility rules: retained in programme definition version 2.
- Draft rating model creation and read-back: working.
- Programme save attempts: rejected atomically; definition version 2 remained unchanged.
- GitHub: not used; both implementation branches remain local.

